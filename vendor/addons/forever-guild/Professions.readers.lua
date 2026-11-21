-- Professions.lua: who has which profession and at what rank, shared with the guild in its own kind `pf`
-- ("id:rank,..."; no p = not sharing). Mine come from the journal's skill snapshot. Spec 2026-10-10-levelmates-extras-design.
local _, ns = ...
local P = {}
ns.Professions = P
local L, C, R = ns.L, ns.Comm, ns.Roster
P.FORGET_DAYS = 30
P.IDS = { 171, 164, 333, 202, 182, 165, 186, 393, 197, 129, 185, 356 }
local KNOWN = {}
for _, id in ipairs(P.IDS) do KNOWN[id] = true end

local function me() return ns.Me() end
local function theirs()
	ns.db.professions = ns.db.professions or {}
	local k = ns.GuildKey()
	ns.db.professions[k] = ns.db.professions[k] or {}
	return ns.db.professions[k]
end

-- At the top of a rank (75, 150, 225): the trainer to visit next. nil otherwise (and at 300, the last).
local NEXT = { [75] = "TRAIN_JOURNEYMAN", [150] = "TRAIN_EXPERT", [225] = "TRAIN_ARTISAN" }
function P.TrainHint(rank, max)
	if not rank or not max or rank < max or not NEXT[max] then return nil end
	return L[NEXT[max]]
end

function P.Name(id) return L["PROF_" .. id] or ("#" .. tostring(id)) end

-- Each profession's icon: the apprentice spell's, as the game draws it; a fixed icon when the client has no such call.
local SPELL = { [171] = 2259, [164] = 2018, [333] = 7411, [202] = 4036, [182] = 2383, [165] = 2108, [186] = 2580, [393] = 8613, [197] = 3908, [129] = 3273, [185] = 2550, [356] = 7620 }
local ICON = { [171] = "Trade_Alchemy", [164] = "Trade_BlackSmithing", [333] = "Trade_Engraving", [202] = "Trade_Engineering", [182] = "Trade_Herbalism", [165] = "Trade_LeatherWorking",
	[186] = "Trade_Mining", [393] = "INV_Misc_Pelt_Wolf_01", [197] = "Trade_Tailoring", [129] = "Spell_Holy_SealOfSacrifice", [185] = "INV_Misc_Food_15", [356] = "Trade_Fishing" }
function P.Icon(id)
	local tex = C_Spell and C_Spell.GetSpellTexture and SPELL[id] and C_Spell.GetSpellTexture(SPELL[id])
	return tex or ("Interface\\Icons\\" .. (ICON[id] or "INV_Misc_QuestionMark"))
end

-- Rows for the tab: a header per profession (by name) with who has it underneath (highest rank first). A search
-- by profession keeps the whole group; a search by name keeps that person under their header.
function P.Groups(search)
	local q, groups, order = (search or ""):lower(), {}, {}
	for _, c in ipairs(P.List()) do
		if q == "" or P.Name(c.id):lower():find(q, 1, true) or c.name:lower():find(q, 1, true) then
			if not groups[c.id] then groups[c.id] = {}; order[#order + 1] = c.id end
			table.insert(groups[c.id], c)
		end
	end
	local out = {}
	for _, id in ipairs(order) do
		out[#out + 1] = { header = id, count = #groups[id] }
		for _, c in ipairs(groups[id]) do out[#out + 1] = c end
	end
	return out
end

function P.Mine()
	local out = {}
	for id, s in pairs(ns.char.skills or {}) do
		if KNOWN[id] and (s.rank or 0) > 0 then
			out[#out + 1] = { id = id, rank = math.min(450, s.rank), max = s.max and s.max > 0 and math.min(450, s.max) or nil }
		end
	end
	table.sort(out, function(a, b) return a.id < b.id end)
	while #out > 6 do table.remove(out) end
	return out
end
