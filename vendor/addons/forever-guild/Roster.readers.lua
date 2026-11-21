-- Roster.lua: what I know about guildmates with the addon, and what I say about myself.
local _, ns = ...
local R = {}
ns.Roster = R
local C = ns.Comm
local HB_EVERY, EXPIRE, PING_JITTER = 30, 120, 5
local KEEPALIVE = 80   -- an unchanged player still announces itself, well inside the 120 s expiry (ticks every 30 s -> ~90 s)

R.mates = {}
local lastSent, lastHb, lastQuestsSig = nil, -math.huge, nil
local xpWindow = {}   -- { t, xp } samples for XP/h over the last hour

-- The guild list as one plain list, whatever the client allows: { name (short), level, rank (its index: 0 is the
-- guild master), rankName, role (1 owner, 2 leader, 3 moderator, 4 member), classID, classFile, online, zone, days
-- (since last seen; nil when online), note }. Forever hands some players (not the guild master) the community list
-- as a secret value (2026-10-14: "table expected, got secret"): then the classic roster is read. A secret entry or
-- field is skipped. nil when the game has not given the list yet.
local function secret(v) return issecretvalue ~= nil and issecretvalue(v) end
local function plain(v) if secret(v) then return nil end; return v end
local OFFLINE = 3   -- Enum.ClubMemberPresence.Offline
-- Read once per change: the game says when the list changes (GUILD_ROSTER_UPDATE, the club's member events), and
-- a short TTL covers whatever it does not say; the book asks many times a redraw.
local membersCache, membersAt = nil, -math.huge
R.MEMBERS_TTL = 60
local function readGuildMembers()
	local out = {}
	local club = plain(C_Club and C_Club.GetGuildClubId and C_Club.GetGuildClubId())
	local okIds, ids = pcall(function() return club and C_Club.GetClubMembers(club) end)
	ids = okIds and plain(ids) or nil
	if type(ids) == "table" then
		for _, id in ipairs(ids) do
			local ok, info = pcall(C_Club.GetMemberInfo, club, id)
			info = ok and plain(info) or nil
			local full = type(info) == "table" and plain(info.name) or nil
			if full then
				local pr = plain(info.presence)
				local online = pr ~= nil and pr ~= OFFLINE   -- unreadable: offline, not online
				local days
				if not online then
					local y, mo, d, h = plain(info.lastOnlineYear), plain(info.lastOnlineMonth), plain(info.lastOnlineDay), plain(info.lastOnlineHour)
					if y or mo or d or h then days = (y or 0) * 365 + (mo or 0) * 30 + (d or 0) + math.floor((h or 0) / 24) end
				end
				out[#out + 1] = { name = ns.ShortName(full), fullName = full, level = plain(info.level) or 0, verifiedRank = plain(info.guildRankOrder), rank = plain(info.guildRankOrder) or 4, rankName = plain(info.guildRank),
					role = plain(info.role) or 4, classID = plain(info.classID), classFile = plain(info.classFileName), online = online, zone = plain(info.zone), days = days, note = plain(info.memberNote) }
			end
		end
	elseif GetNumGuildMembers and GetGuildRosterInfo then
		local n = plain(GetNumGuildMembers()) or 0
		for i = 1, n do
			local full, rankName, rankIndex, level, _, zone, note, _, online, _, classFile = GetGuildRosterInfo(i)
			full = plain(full)
			if full then
				online = plain(online) and true or false
				local days
				if not online and GetGuildRosterLastOnline then
					local y, m, d, h = GetGuildRosterLastOnline(i)
					y = plain(y)
					if y then days = y * 365 + (plain(m) or 0) * 30 + (plain(d) or 0) + math.floor((plain(h) or 0) / 24) end
				end
				rankIndex = plain(rankIndex)
				out[#out + 1] = { name = ns.ShortName(full), fullName = full, level = plain(level) or 0, verifiedRank = rankIndex, rank = rankIndex or 4, rankName = plain(rankName),
					role = rankIndex == 0 and 1 or rankIndex == 1 and 2 or 4, classFile = plain(classFile), online = online, zone = plain(zone), days = days, note = plain(note) }
			end
		end
	end
	if #out == 0 then return nil end
	return out
end
function R.GuildMembers()
	if membersCache and GetTime() - membersAt < R.MEMBERS_TTL then return membersCache end
	membersCache, membersAt = readGuildMembers(), GetTime()
	return membersCache
end

-- Guild roster as a name set, cached: the hidden channel is open to anyone, so the roster is the whitelist.
local guildSet, guildSetAt = nil, -math.huge
local ROSTER_TTL = 300
local function buildGuildSet()
	local set = {}
	for _, m in ipairs(R.GuildMembers() or {}) do set[m.name] = m.role or 4 end
	return set
end
function R.InvalidateGuildRoster() guildSet = nil; membersCache = nil end
-- The guild list has arrived from the server (I am on it): until then nobody can be told apart from a stranger.
function R.RosterLoaded() return R.IsGuildmate(ns.Me()) end
function R.IsGuildmate(name)
	if not guildSet or GetTime() - guildSetAt > ROSTER_TTL then
		guildSet = buildGuildSet(); guildSetAt = GetTime()
		if next(guildSet) == nil then guildSet = nil; return false end   -- not loaded yet (login): ask again next time
	end
	return guildSet[name] ~= nil   -- no roster available: nobody is trusted
end

-- Officers: community role Owner (1, guild master) or Leader (2, officer), the rule Blizzard's own UI uses.
function R.IsOfficer(name)
	if not R.IsGuildmate(name) then return false end
	local role = guildSet[name]
	return role == 1 or role == 2
end
-- A secret or failing answer is "not an officer" (never a right by mistake); the rank index 0 is the guild master.
function R.IAmOfficer()
	local ok, leader = pcall(function() return IsGuildLeader and IsGuildLeader() end)
	if ok and ns.Plain(leader) == true then return true end
	local ok2, officer = pcall(function() return C_GuildInfo and C_GuildInfo.IsGuildOfficer and C_GuildInfo.IsGuildOfficer() end)
	if ok2 and ns.Plain(officer) == true then return true end
	local ok3, _, _, rank = pcall(GetGuildInfo, "player")
	return ok3 and ns.Plain(rank) == 0
end
