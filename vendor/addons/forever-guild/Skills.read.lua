-- Professions: the twelve profession skill IDs (locale-independent).
local PROFESSIONS = { [171] = true, [164] = true, [333] = true, [202] = true, [182] = true, [165] = true,
	[186] = true, [393] = true, [197] = true, [129] = true, [185] = true, [356] = true }
-- The skills window can collapse headers, which removes their lines from the enumeration: look professions up by ID
-- when the client can; otherwise treat lines hidden under a collapsed header as unknown (kept), never as unlearned.
local function readProfessions(before)
	local n = C_SkillInfo and C_SkillInfo.GetNumSkillLines() or 0
	if n == 0 then return nil end   -- not loaded yet
	local out = {}
	if C_SkillInfo.GetSkillLineInfoByID then
		for id in pairs(PROFESSIONS) do
			local s = C_SkillInfo.GetSkillLineInfoByID(id)
			if s and s.name and s.name ~= "" and (s.rank or 0) > 0 then out[id] = { name = s.name, rank = s.rank, max = s.maxRank } end
		end
		return out
	end
	local collapsed = false
	for i = 1, n do
		local s = C_SkillInfo.GetSkillLineInfo(i)
		if s and s.isHeader and s.isCollapsed then collapsed = true end
		if s and not s.isHeader and PROFESSIONS[s.skillID] then out[s.skillID] = { name = s.name, rank = s.rank, max = s.maxRank } end
	end
	if collapsed and before then
		for id, old in pairs(before) do if not out[id] then out[id] = old end end
	end
	return out
end
