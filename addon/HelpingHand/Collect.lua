local H = HelpingHand
local professionIDs = {171,164,333,202,182,165,186,393,197,129,185,356}
local function text(v) return type(H.Plain(v)) == "string" and v ~= "" and v or nil end
local function integer(v) return type(H.Plain(v)) == "number" and v == math.floor(v) and v or nil end

function H.Identity()
    local name, second = H.Call(UnitName, "player")
    local realm = H.Call(GetRealmName)
    if H.Call(RegionalUniqueNamesEnabled) == true and text(second) then
        local sep = Constants and Constants.CharacterNameSeparatorConsts
        sep = sep and sep.CHARACTERNAME_SURNAME_SEPARATOR or " "
        if not name:find(sep, 1, true) then name = name .. sep .. second end
    elseif UnitFullName then
        local full, fullRealm = H.Call(UnitFullName, "player")
        name, realm = full or name, fullRealm or realm
    end
    if not text(name) or not text(realm) then return nil end
    return {name = name, realm = realm, guid = H.Call(UnitGUID, "player")}
end

function H.IsOwner()
    local _, _, rank = H.Call(GetGuildInfo, "player")
    return rank == 0
end

local function recipes(professionID)
    local T = C_TradeSkillUI
    if not T or H.Call(T.IsTradeSkillReady) ~= true then return nil end
    for _, method in ipairs({"IsTradeSkillLinked", "IsTradeSkillGuild", "IsTradeSkillGuildMember", "IsNPCCrafting"}) do
        if type(T[method]) ~= "function" or H.Call(T[method]) ~= false then return nil end
    end
    local info = H.Call(T.GetBaseProfessionInfo)
    if type(info) ~= "table" then return nil end
    if H.Plain(info.professionID) ~= professionID and H.Plain(info.parentProfessionID) ~= professionID then return nil end
    local ids = H.Call(T.GetAllRecipeIDs)
    if type(ids) ~= "table" then return nil end
    local out = {}
    for _, id in ipairs(ids) do
        local recipe = H.Call(T.GetRecipeInfo, id)
        if type(recipe) ~= "table" then return nil end
        if H.Plain(recipe.learned) == true and integer(id) and text(recipe.name) then
            local link = H.Call(T.GetRecipeItemLink, id)
            local itemID = type(link) == "string" and tonumber(link:match("item:(%d+)")) or nil
            out[#out + 1] = {id = id, name = recipe.name, itemId = itemID, kind = itemID and "item" or "enchant"}
        end
    end
    -- Empty or filtered reads do not prove a complete learned-recipe list.
    return #out > 0 and out or nil
end

function H.Professions()
    local S, out = C_SkillInfo, {}
    if not S or not S.GetSkillLineInfoByID then return nil end
    for _, id in ipairs(professionIDs) do
        local skill = H.Call(S.GetSkillLineInfoByID, id)
        if type(skill) == "table" and text(skill.name) and integer(skill.rank) and skill.rank > 0 then
            out[#out + 1] = {id = id, name = skill.name, rank = skill.rank,
                maxRank = integer(skill.maxRank) or skill.rank, recipes = recipes(id)}
        end
    end
    return #out > 0 and out or nil
end

function H.Roster(realm)
    local members = {}
    local count = H.Call(GetNumGuildMembers) or 0
    for i = 1, math.min(count, 2000) do
        local name, rankName, rankIndex, level, className = H.Call(GetGuildRosterInfo, i)
        if text(name) and text(rankName) and integer(rankIndex) and integer(level) and text(className) then
            local characterName, characterRealm = name:match("^(.-)%-(.+)$")
            members[#members + 1] = {name = characterName or name, realm = characterRealm or realm,
                rankName = rankName, rankIndex = rankIndex, level = level, className = className}
        end
    end
    return {complete = false, members = members}
end

function H.Banks(guildName, realm, roster)
    local G = TOGBankClassic_Guild
    if type(G) ~= "table" or not G.GetAltItems or not G.IsBank or not G.IsViewOnlyBank then return nil end
    if type(G.Info) ~= "table" or H.Plain(G.Info.name) ~= guildName then return nil end
    local banks = {}
    for _, member in ipairs(roster.members) do
        if H.Call(G.IsBank, G, member.name) == true then
            local viewOnly = H.Call(G.IsViewOnlyBank, G, member.name)
            local rows = H.Call(G.GetAltItems, G, member.name)
            if type(rows) == "table" and type(viewOnly) == "boolean" then
                local Store = TOGBankClassic_Inventory_Store
                local complete = type(Store) == "table"
                    and H.Call(Store.HasAlt, Store, guildName, member.name) == true
                    and H.Call(Store.IsAltComplete, Store, guildName, member.name) == true
                local items, indices, largest = {}, {}, 0
                for index in pairs(rows) do
                    if integer(index) and index > 0 then
                        indices[#indices + 1] = index
                        largest = math.max(largest, index)
                    else
                        complete = false
                    end
                end
                if largest ~= #indices then complete = false end
                table.sort(indices)
                for _, index in ipairs(indices) do
                    local row = rows[index]
                    if type(row) ~= "table" then
                        complete = false
                    elseif H.Plain(row.Hidden) ~= true then
                        local id, count = integer(row.ID), integer(row.Count)
                        local info = type(row.Info) == "table" and row.Info or {}
                        local link = text(row.Link) or ""
                        local fields = {}
                        for part in (link:match("item:([^|]+)") or ""):gmatch("([^:]*):?") do fields[#fields + 1] = part end
                        local suffix = integer(row.Suffix) or tonumber(fields[7]) or 0
                        local enchant = integer(row.Enchant) or tonumber(fields[2]) or 0
                        if id and id > 0 and count and count > 0 and integer(suffix) and integer(enchant) then
                            items[#items + 1] = {itemId = id, count = count, suffixId = suffix, enchantId = enchant,
                                name = text(info.name) or text(row.Name) or ("Item #" .. id), quality = integer(info.rarity)}
                        else
                            complete = false
                        end
                    end
                end
                banks[#banks + 1] = {name = member.name, realm = realm, guildName = guildName,
                    viewOnly = viewOnly, complete = complete, items = items}
            end
        end
    end
    return #banks > 0 and banks or nil
end

function H.Collect(includeGuild)
    local identity = H.Identity()
    local guildName = H.Call(GetGuildInfo, "player")
    if not identity or not text(identity.guid) or not text(guildName) then return nil, "Join the guild and wait for character data before capture." end
    if includeGuild and not H.IsOwner() then return nil, "Only the guild owner can capture guild data." end
    local region = H.Call(GetCurrentRegion)
    local regions = {[1] = "us", [2] = "kr", [3] = "eu", [4] = "tw", [5] = "cn"}
    if not regions[region] then return nil, "The client could not identify your region." end
    local character = {name = identity.name, realm = identity.realm, guid = identity.guid,
        level = H.Call(UnitLevel, "player"), className = H.Call(UnitClass, "player"), professions = H.Professions()}
    local snapshot = {schemaVersion = 1, capturedAt = H.Call(GetServerTime) or H.Call(time),
        source = {addonVersion = H.version, character = identity,
            guild = {name = guildName, realm = identity.realm, region = regions[region]}}, characters = {character}}
    if includeGuild then
        snapshot.roster = H.Roster(identity.realm)
        snapshot.banks = H.Banks(guildName, identity.realm, snapshot.roster)
    end
    return snapshot
end
