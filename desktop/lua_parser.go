package main

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	maxOutboxBytes = 8 * 1024 * 1024
	maxLuaNodes    = 150000
	maxLuaDepth    = 32
)

var (
	jwtPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)
	arrayFields   = map[string]bool{"characters": true, "professions": true, "recipes": true, "members": true, "banks": true, "items": true, "bankLog": true, "guildBankHistory": true, "entries": true}
	privateFields = map[string]bool{"token": true, "authorization": true, "hidden": true, "password": true, "secret": true}
)

type luaTable struct {
	entries map[any]any
}

type luaParser struct {
	src   string
	pos   int
	nodes int
}

func (p *luaParser) skipSpace() {
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			p.pos++
			continue
		}
		if c == '-' && p.pos+1 < len(p.src) && p.src[p.pos+1] == '-' {
			p.pos += 2
			for p.pos < len(p.src) && p.src[p.pos] != '\n' {
				p.pos++
			}
			continue
		}
		return
	}
}

func (p *luaParser) take(s string) bool {
	p.skipSpace()
	if strings.HasPrefix(p.src[p.pos:], s) {
		p.pos += len(s)
		return true
	}
	return false
}

func (p *luaParser) require(s string) error {
	if !p.take(s) {
		return errors.New("The saved file contains unsupported Lua syntax. Use the HelpingHand.lua saved file.")
	}
	return nil
}

func isIdentStart(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'
}

func isIdentChar(c byte) bool {
	return isIdentStart(c) || (c >= '0' && c <= '9')
}

func (p *luaParser) ident() (string, error) {
	p.skipSpace()
	start := p.pos
	if p.pos >= len(p.src) || !isIdentStart(p.src[p.pos]) {
		return "", errors.New("The saved file contains an invalid data name.")
	}
	p.pos++
	for p.pos < len(p.src) && isIdentChar(p.src[p.pos]) {
		p.pos++
	}
	return p.src[start:p.pos], nil
}

func (p *luaParser) parseString() (string, error) {
	quote := p.src[p.pos]
	p.pos++
	var b strings.Builder
	for p.pos < len(p.src) {
		ch := p.src[p.pos]
		p.pos++
		if ch == quote {
			return b.String(), nil
		}
		if ch == '\\' {
			if p.pos >= len(p.src) {
				break
			}
			esc := p.src[p.pos]
			p.pos++
			if esc >= '0' && esc <= '9' {
				digits := string(esc)
				for i := 0; i < 2 && p.pos < len(p.src) && p.src[p.pos] >= '0' && p.src[p.pos] <= '9'; i++ {
					digits += string(p.src[p.pos])
					p.pos++
				}
				n, _ := strconv.Atoi(digits)
				if n > 255 {
					return "", errors.New("The saved file contains an invalid string escape.")
				}
				b.WriteByte(byte(n))
			} else {
				switch esc {
				case 'a':
					b.WriteByte('\a')
				case 'b':
					b.WriteByte('\b')
				case 'f':
					b.WriteByte('\f')
				case 'n':
					b.WriteByte('\n')
				case 'r':
					b.WriteByte('\r')
				case 't':
					b.WriteByte('\t')
				case 'v':
					b.WriteByte('\v')
				case '\\', '"', '\'':
					b.WriteByte(esc)
				default:
					return "", errors.New("The saved file contains an unsupported string escape.")
				}
			}
		} else if ch == '\r' || ch == '\n' || ch < 32 {
			return "", errors.New("The saved file contains an invalid string.")
		} else {
			b.WriteByte(ch)
		}
	}
	return "", errors.New("The saved file contains an incomplete string. Use /reload and try again.")
}

func (p *luaParser) parseValue(depth int) (any, error) {
	p.skipSpace()
	p.nodes++
	if depth > maxLuaDepth || p.nodes > maxLuaNodes {
		return nil, errors.New("The saved file exceeds the supported data limits.")
	}
	if p.pos >= len(p.src) {
		return nil, errors.New("The saved file is incomplete. Use /reload and try again.")
	}
	ch := p.src[p.pos]
	if ch == '"' || ch == '\'' {
		return p.parseString()
	}
	if p.take("{") {
		tbl := &luaTable{entries: map[any]any{}}
		idx := int64(1)
		for !p.take("}") {
			var key any
			if p.take("[") {
				k, err := p.parseValue(depth + 1)
				if err != nil {
					return nil, err
				}
				switch k.(type) {
				case string, int64:
					key = k
				default:
					return nil, errors.New("The saved file contains an invalid table key.")
				}
				if err := p.require("]"); err != nil {
					return nil, err
				}
				if err := p.require("="); err != nil {
					return nil, err
				}
			} else {
				saved := p.pos
				if name, err := p.ident(); err == nil && p.take("=") {
					key = name
				} else {
					p.pos = saved
					key = idx
					idx++
				}
			}
			if _, exists := tbl.entries[key]; exists {
				return nil, errors.New("The saved file contains a duplicate table key.")
			}
			val, err := p.parseValue(depth + 1)
			if err != nil {
				return nil, err
			}
			tbl.entries[key] = val
			if !p.take(",") && !p.take(";") {
				if err := p.require("}"); err != nil {
					return nil, err
				}
				break
			}
		}
		return tbl, nil
	}
	for _, lit := range []struct {
		text string
		val  any
	}{{"true", true}, {"false", false}, {"nil", nil}} {
		if strings.HasPrefix(p.src[p.pos:], lit.text) {
			end := p.pos + len(lit.text)
			if end == len(p.src) || !isIdentChar(p.src[end]) {
				p.pos = end
				return lit.val, nil
			}
		}
	}
	start := p.pos
	if p.src[p.pos] == '-' {
		p.pos++
	}
	digits := 0
	for p.pos < len(p.src) && p.src[p.pos] >= '0' && p.src[p.pos] <= '9' {
		p.pos++
		digits++
	}
	if digits > 0 {
		if p.pos < len(p.src) && p.src[p.pos] == '.' {
			p.pos++
			for p.pos < len(p.src) && p.src[p.pos] >= '0' && p.src[p.pos] <= '9' {
				p.pos++
			}
		}
		if p.pos < len(p.src) && (p.src[p.pos] == 'e' || p.src[p.pos] == 'E') {
			p.pos++
			if p.pos < len(p.src) && (p.src[p.pos] == '+' || p.src[p.pos] == '-') {
				p.pos++
			}
			for p.pos < len(p.src) && p.src[p.pos] >= '0' && p.src[p.pos] <= '9' {
				p.pos++
			}
		}
		num, err := strconv.ParseFloat(p.src[start:p.pos], 64)
		if err != nil || math.Trunc(num) != num || math.Abs(num) > float64((int64(1)<<53)-1) {
			return nil, errors.New("The saved file contains an unsupported number.")
		}
		return int64(num), nil
	}
	return nil, errors.New("The saved file contains executable or unsupported Lua syntax.")
}

func (p *luaParser) parseNamed(target string) (*luaTable, error) {
	var selected *luaTable
	seen := map[string]bool{}
	for {
		p.skipSpace()
		if p.pos == len(p.src) {
			break
		}
		name, err := p.ident()
		if err != nil {
			return nil, err
		}
		if seen[name] {
			return nil, errors.New("The saved file repeats a global variable.")
		}
		seen[name] = true
		if err := p.require("="); err != nil {
			return nil, err
		}
		val, err := p.parseValue(0)
		if err != nil {
			return nil, err
		}
		if name == target {
			tbl, ok := val.(*luaTable)
			if !ok {
				return nil, errors.New(target + " is missing. Select the correct account SavedVariables file.")
			}
			selected = tbl
		}
	}
	if selected == nil {
		return nil, errors.New(target + " is missing. Select the correct account SavedVariables file.")
	}
	return selected, nil
}

func (p *luaParser) parse() (*luaTable, error) {
	return p.parseNamed("HelpingHandDB")
}

// ReadTOGBankLog reads only the public bank transaction log from TOGBankClassic.lua
// for the specified guild, never exposing hidden/private inventory.
func ReadTOGBankLog(path string, guildName string) []any {
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) > maxOutboxBytes {
		return nil
	}
	src := strings.TrimPrefix(string(raw), "\uFEFF")
	invDB, err := (&luaParser{src: src}).parseNamed("TOGBankClassicInvDB")
	if err != nil {
		return nil
	}
	faction, ok := invDB.entries["faction"].(*luaTable)
	if !ok {
		return nil
	}
	var guildTbl *luaTable
	for k, v := range faction.entries {
		if ks, ok := k.(string); ok && strings.EqualFold(strings.TrimSpace(ks), strings.TrimSpace(guildName)) {
			if gt, ok := v.(*luaTable); ok {
				guildTbl = gt
				break
			}
		}
	}
	if guildTbl == nil {
		return nil
	}
	logTbl, ok := guildTbl.entries["log"].(*luaTable)
	if !ok {
		return nil
	}
	out := make([]any, 0, len(logTbl.entries))
	for i := int64(1); i <= int64(len(logTbl.entries)); i++ {
		row, ok := logTbl.entries[i].(*luaTable)
		if !ok {
			continue
		}
		entry := map[string]any{}
		for _, k := range []string{"type", "ts", "name", "from", "to", "itemID", "suffixID", "item", "count", "money", "requestId", "note"} {
			if val, exists := row.entries[k]; exists && val != nil {
				entry[k] = val
			}
		}
		if _, hasType := entry["type"]; hasType {
			out = append(out, entry)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func toJSONValue(val any, field string) (any, error) {
	tbl, ok := val.(*luaTable)
	if !ok {
		return val, nil
	}
	if arrayFields[field] {
		out := make([]any, 0, len(tbl.entries))
		for i := int64(1); i <= int64(len(tbl.entries)); i++ {
			item, exists := tbl.entries[i]
			if !exists {
				return nil, errors.New("The outbox contains an invalid list.")
			}
			converted, err := toJSONValue(item, "")
			if err != nil {
				return nil, err
			}
			out = append(out, converted)
		}
		return out, nil
	}
	out := make(map[string]any, len(tbl.entries))
	for k, v := range tbl.entries {
		ks, ok := k.(string)
		if !ok {
			return nil, errors.New("The outbox contains an invalid object.")
		}
		if privateFields[strings.ToLower(ks)] {
			return nil, errors.New("The outbox contains private fields. Capture again with the current addon.")
		}
		if v == nil {
			continue
		}
		converted, err := toJSONValue(v, ks)
		if err != nil {
			return nil, err
		}
		out[ks] = converted
	}
	return out, nil
}

func ReadOutbox(path string) (string, []byte, map[string]any, error) {
	f, info, err := openRegularFile(path)
	if err != nil {
		return "", nil, nil, err
	}
	defer f.Close()
	if info.Size() > maxOutboxBytes {
		return "", nil, nil, errors.New("The saved file exceeds 8 MiB.")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maxOutboxBytes+1))
	if err != nil {
		return "", nil, nil, errors.New("Cannot read the saved file. Check its path and use /reload.")
	}
	if len(raw) > maxOutboxBytes {
		return "", nil, nil, errors.New("The saved file exceeds 8 MiB.")
	}
	src := strings.TrimPrefix(string(raw), "\uFEFF")
	db, err := (&luaParser{src: src}).parse()
	if err != nil {
		return "", nil, nil, err
	}
	token, _ := db.entries["token"].(string)
	if token != "" && (len(token) > 4096 || !jwtPattern.MatchString(token)) {
		token = ""
	}
	converted, err := toJSONValue(db.entries["outbox"], "")
	if err != nil {
		return "", nil, nil, err
	}
	payload, ok := converted.(map[string]any)
	if !ok {
		return "", nil, nil, errors.New("The outbox is empty or unsupported. Capture data in the addon, then use /reload.")
	}
	version, _ := payload["schemaVersion"].(int64)
	snapID, _ := payload["snapshotId"].(string)
	if version != 1 || snapID == "" {
		return "", nil, nil, errors.New("The outbox is empty or unsupported. Capture data in the addon, then use /reload.")
	}
	body, err := json.Marshal(payload)
	if err != nil || len(body) > maxOutboxBytes {
		return "", nil, nil, errors.New("The outbox exceeds the upload limit.")
	}
	return token, body, payload, nil
}
