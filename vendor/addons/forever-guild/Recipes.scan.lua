-- Recipes.lua: what each one can craft. Mine are read from my own profession window (never someone else's), kept per
-- profession as item ids (and spell ids for enchants), and shared as personal state `rcp` in a compact form: sorted
-- ids as base-36 differences. Then "who crafts this?" and a line in item tooltips.
-- Spec 2026-10-12-levelmates-recipes-design.
local _, ns = ...
local RC = {}
ns.Recipes = RC
local L, C, R = ns.L, ns.Comm, ns.Roster
RC.MAX, RC.TOP, RC.SETTLE = 800, 10000000, 1.5
RC.scans = 0

------------------------------------------------------------------ encoding
local DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
local function b36(n)
	local s = ""
	repeat local r = n % 36; s = DIGITS:sub(r + 1, r + 1) .. s; n = math.floor(n / 36) until n == 0
	return s
end
-- Sorted, without repeats, each as the difference from the one before, in base 36, joined with "-".
function RC.Encode(list)
	local sorted, seen = {}, {}
	for _, v in ipairs(list or {}) do if not seen[v] then seen[v] = true; sorted[#sorted + 1] = v end end
	table.sort(sorted)
	local parts, prev = {}, 0
	for _, v in ipairs(sorted) do parts[#parts + 1] = b36(v - prev); prev = v end
	return table.concat(parts, "-")
end
-- nil for anything that is not a clean list (a zero difference, too many, too big, a stray character).
function RC.Decode(s)
	if type(s) ~= "string" then return nil end
	if s == "" then return {} end
	if not s:match("^[0-9a-z%-]+$") then return nil end
	local out, prev = {}, 0
	for part in s:gmatch("[^%-]+") do
		local d = tonumber(part, 36)
		if not d or d <= 0 then return nil end
		prev = prev + d
		if prev > RC.TOP then return nil end
		out[#out + 1] = prev
		if #out > RC.MAX then return nil end
	end
	return out
end

------------------------------------------------------------------ my recipes
function RC.Mine() ns.char.recipes = ns.char.recipes or {}; return ns.char.recipes end

-- My window only: not linked, not the guild's view, not an NPC crafter; and the profession is one of mine.
local function myWindow()
	local T = C_TradeSkillUI
	if not T then return false end
	local okR, ready = pcall(function() return T.IsTradeSkillReady and T.IsTradeSkillReady() end)
	if not okR or ns.Plain(ready) ~= true then return false end
	for _, fn in ipairs({ "IsTradeSkillLinked", "IsTradeSkillGuild", "IsTradeSkillGuildMember", "IsNPCCrafting" }) do
		local ok, v = pcall(function() return T[fn] and T[fn]() end)
		if not ok or ns.Plain(v) then return false end   -- a check that fails is not "no": not read
	end
	return true
end
-- The profession's line as our skills know it (171 Alchemy…): a newer client may give a child id with its parent.
local KNOWN_LINES = {}
for _, id in ipairs(ns.Professions.IDS) do KNOWN_LINES[id] = true end
local told
local function line()
	local okI, info = pcall(function() return C_TradeSkillUI.GetBaseProfessionInfo and C_TradeSkillUI.GetBaseProfessionInfo() end)
	info = okI and ns.Plain(info) or nil
	if type(info) ~= "table" or not ns.Plain(info.professionID) then return nil end
	local id = info.professionID
	if not KNOWN_LINES[id] and info.parentProfessionID and KNOWN_LINES[info.parentProfessionID] then id = info.parentProfessionID end
	if not KNOWN_LINES[id] then
		if not told then told = true; ns.Log("recipes: unknown profession id %s (parent %s)", tostring(info.professionID), tostring(info.parentProfessionID)) end
		return nil
	end
	return id, info.skillLevel or 0, info.maxSkillLevel or 0
end
local function outputItem(rid)
	local okO, out = pcall(function() return C_TradeSkillUI.GetRecipeOutputItemData and C_TradeSkillUI.GetRecipeOutputItemData(rid) end)
	out = okO and ns.Plain(out) or nil
	local item = type(out) == "table" and (ns.Plain(out.itemID) or tonumber(tostring(ns.Plain(out.hyperlink) or ""):match("item:(%d+)") or ""))
	if item then return item end
	local okL, link = pcall(function() return C_TradeSkillUI.GetRecipeItemLink and C_TradeSkillUI.GetRecipeItemLink(rid) end)   -- older clients
	link = okL and ns.Plain(link) or nil
	return link and tonumber(tostring(link):match("item:(%d+)") or "")
end
function RC.Scan()
	if not myWindow() then return end
	local id, rank, max = line()
	if not id then return end
	local skills = ns.char.skills
	if skills and next(skills) and not skills[id] then return end   -- not one of my professions (as my skills know them)
	if skills and skills[id] and skills[id].rank and math.abs(rank - skills[id].rank) > RC.RANK_MARGIN then return end   -- not my rank: not my window
	RC.scans = RC.scans + 1
	local items, spells, recipeIDs = {}, {}, {}
	local okA, all = pcall(C_TradeSkillUI.GetAllRecipeIDs)
	for _, rid in ipairs(okA and ns.List(all) or {}) do
		local okI, info = pcall(C_TradeSkillUI.GetRecipeInfo, rid)
		info = okI and ns.Plain(info) or nil
		if type(info) == "table" and ns.Plain(info.learned) ~= false then
			local item = outputItem(rid)
			if item then items[#items + 1] = item; recipeIDs[item] = rid else spells[#spells + 1] = rid end
		end
	end
	local mine = RC.Mine()
	if #items + #spells == 0 and mine[id] then return end   -- an empty read never wipes a filled one
	local old = mine[id]
	local new = { r = math.min(450, rank), m = math.min(450, max), items = items, spells = spells, recipeIDs = recipeIDs, t = time() }
	mine[id] = new
	while #items > RC.MAX do table.remove(items) end
	while #spells > RC.MAX do table.remove(spells) end
	if not old or RC.Encode(old.items) ~= RC.Encode(items) or RC.Encode(old.spells) ~= RC.Encode(spells) then   -- the rank alone travels in pf
		ns.Fire("LM_RECIPES_CHANGED", id)
	end
end

-- Against the game's own list of my professions (the skill lines, Journal.lua): a profession I don't have, or kept at
-- a rank well above my real one (skill never goes down: those recipes came from someone else's window), is dropped and
-- the corrected list shared again; otherwise its rank is brought up to date. The margin leaves room for racial and
-- item bonuses the window may count.
RC.RANK_MARGIN = 25
function RC.CheckMine()
	local skills = ns.char.skills
	if not (skills and next(skills)) then return end   -- not known yet: nothing to judge by
	local mine, dropped = RC.Mine(), false
	for p, e in pairs(mine) do
		local s = skills[p]
		if not s or (e.r or 0) > (s.rank or 0) + RC.RANK_MARGIN then
			mine[p] = nil; dropped = true
		elseif s.rank then
			e.r = math.min(450, s.rank)
			if s.max and s.max > 0 then e.m = math.min(450, s.max) end
		end
	end
	if dropped then ns.Fire("LM_RECIPES_CHANGED") end
end
