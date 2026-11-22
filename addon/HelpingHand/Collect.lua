local H = HelpingHand
local professionIDs = {171,164,333,202,182,165,186,393,197,129,185,356}
local function text(v) return type(H.Plain(v)) == "string" and v ~= "" and v or nil end
local function integer(v) return type(H.Plain(v)) == "number" and v == math.floor(v) and v or nil end

function H.Identity()
    local name, second = H.Call(UnitName, "player")
    local realm = text(H.Call(GetRealmName)) or text(H.Call(GetNormalizedRealmName))
    local foreverNames = H.Call(RegionalUniqueNamesEnabled) == true
    if (foreverNames or not realm) and text(second) then
        local sep = Constants and Constants.CharacterNameSeparatorConsts
        sep = sep and sep.CHARACTERNAME_SURNAME_SEPARATOR or " "
        if text(name) and not name:find(sep, 1, true) then name = name .. sep .. second end
    elseif UnitFullName then
        local full, fullRealm = H.Call(UnitFullName, "player")
        name = text(full) or name
        realm = text(fullRealm) or realm
    end
    if not text(name) then return nil end
    realm = text(realm) or "Forever"
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

local function hasGbankNote(note)
    return type(note) == "string" and note:lower():find("gbank", 1, true) ~= nil
end

function H.Roster(realm)
    local members = {}
    local count = H.Call(GetNumGuildMembers) or 0
    for i = 1, math.min(count, 2000) do
        local name, rankName, rankIndex, level, className, zone, publicNote, officerNote, isOnline = H.Call(GetGuildRosterInfo, i)
        if text(name) and text(rankName) and integer(rankIndex) and integer(level) and text(className) then
            local characterName, characterRealm = name:match("^(.-)%-(.+)$")
            local online = isOnline == true
            members[#members + 1] = {name = characterName or name, realm = characterRealm or realm,
                rankName = rankName, rankIndex = rankIndex, level = level, className = className,
                online = online, zone = online and text(zone) or nil,
                isGbank = hasGbankNote(publicNote) or hasGbankNote(officerNote) or nil}
        end
    end
    return {complete = false, members = members}
end

local function mergeNativeBankItems(rec)
    local byKey, out = {}, {}
    for _, list in ipairs({rec.bags, rec.bank, rec.mail}) do
        if type(list) == "table" then
            for _, it in ipairs(list) do
                if type(it) == "table" and integer(it.itemId) and it.itemId > 0 and integer(it.count) and it.count > 0 then
                    local s = integer(it.suffixId) or 0
                    local e = integer(it.enchantId) or 0
                    local key = it.itemId .. ":" .. s .. ":" .. e
                    local existing = byKey[key]
                    if existing then
                        existing.count = existing.count + it.count
                    else
                        local row = {
                            itemId = it.itemId, suffixId = s, enchantId = e, count = it.count,
                            name = text(it.name) or ("Item #" .. it.itemId),
                            quality = integer(it.quality),
                            vendorPrice = integer(it.vendorPrice) and it.vendorPrice >= 0 and it.vendorPrice or nil
                        }
                        byKey[key] = row
                        out[#out + 1] = row
                    end
                end
            end
        end
    end
    return out
end

function H.Banks(guildName, realm, roster)
    local banks, seen, ubManaged = {}, {}, {}

    -- 1. Ultimate Bank takes precedence when installed and managing a bank character
    --    so its hidden-item and view-only rules are always enforced.
    local G = TOGBankClassic_Guild
    if type(G) == "table" and G.GetAltItems and G.IsBank and G.IsViewOnlyBank and type(G.Info) == "table" and H.Plain(G.Info.name) == guildName then
        for _, member in ipairs(roster.members) do
            local key = member.name:lower()
            local isBank = H.Call(G.IsBank, G, member.name) == true or member.isGbank == true
            if isBank then
                -- Record Ultimate Bank management immediately so a reader failure never falls back to raw native stock.
                ubManaged[key] = true
            end
            if isBank and not seen[key] then
                local viewOnly = H.Call(G.IsViewOnlyBank, G, member.name)
                local rows = H.Call(G.GetAltItems, G, member.name)
                if type(rows) == "table" and type(viewOnly) == "boolean" then
                    local Store = TOGBankClassic_Inventory_Store
                    local items, indices, largest, hadMalformed = {}, {}, 0, false
                    for index in pairs(rows) do
                        if integer(index) and index > 0 then
                            indices[#indices + 1] = index
                            largest = math.max(largest, index)
                        else
                            hadMalformed = true
                        end
                    end
                    if largest ~= #indices then hadMalformed = true end
                    table.sort(indices)
                    for _, index in ipairs(indices) do
                        local row = rows[index]
                        if type(row) ~= "table" then
                            hadMalformed = true
                        elseif H.Plain(row.Hidden) ~= true then
                            local id, count = integer(row.ID), integer(row.Count)
                            local info = type(row.Info) == "table" and row.Info or {}
                            local link = text(row.Link) or ""
                            local fields = {}
                            for part in (link:match("item:([^|]+)") or ""):gmatch("([^:]*):?") do fields[#fields + 1] = part end
                            local suffix, enchant = 0, 0
                            local variantOk = true
                            if row.Suffix ~= nil then
                                suffix = integer(row.Suffix)
                                if not suffix or suffix < -2147483647 or suffix > 2147483647 then variantOk = false end
                            elseif fields[7] and fields[7] ~= "" then
                                suffix = integer(tonumber(fields[7]))
                                if not suffix or suffix < -2147483647 or suffix > 2147483647 then variantOk = false end
                            end
                            if row.Enchant ~= nil then
                                enchant = integer(row.Enchant)
                                if not enchant or enchant < 0 or enchant > 2147483647 then variantOk = false end
                            elseif fields[2] and fields[2] ~= "" then
                                enchant = integer(tonumber(fields[2]))
                                if not enchant or enchant < 0 or enchant > 2147483647 then variantOk = false end
                            end
                            if variantOk and id and id > 0 and count and count > 0 then
                                local vendorPrice = nil
                                if GetItemInfo then
                                    local _, _, _, _, _, _, _, _, _, _, sellPrice = H.Call(GetItemInfo, id)
                                    if integer(sellPrice) and sellPrice >= 0 then vendorPrice = sellPrice end
                                end
                                items[#items + 1] = {itemId = id, count = count, suffixId = suffix, enchantId = enchant,
                                    name = text(info.name) or text(row.Name) or ("Item #" .. id), quality = integer(info.rarity),
                                    vendorPrice = vendorPrice}
                            else
                                hadMalformed = true
                            end
                        end
                    end
                    -- Require zero malformed/sparse rows AND confirmed full store coverage (including mail) before setting itemsKnown=true.
                    local hasCoverage = false
                    local storeChecked = false
                    local sourceVersion = nil
                    local guildAlt = type(G.Info.alts) == "table" and G.Info.alts[member.name] or nil
                    if type(guildAlt) == "table" and (guildAlt.version ~= nil or guildAlt.inventoryUpdatedAt ~= nil) then
                        sourceVersion = tostring(guildAlt.version or "") .. ":" .. tostring(guildAlt.inventoryUpdatedAt or "")
                    end
                    if type(Store) == "table" and type(Store.IsAltComplete) == "function" then
                        storeChecked = true
                        local hasAlt = type(Store.HasAlt) ~= "function" or H.Call(Store.HasAlt, Store, guildName, member.name) == true
                        if hasAlt and H.Call(Store.IsAltComplete, Store, guildName, member.name) == true then
                            hasCoverage = true
                        end
                    end
                    if type(TOGBankClassicInvDB) == "table" then
                        local fac = type(TOGBankClassicInvDB.faction) == "table" and TOGBankClassicInvDB.faction[guildName] or nil
                        local altRec = type(fac) == "table" and type(fac.alts) == "table" and fac.alts[member.name] or nil
                        if type(altRec) == "table" then
                            -- Use publication version/inventoryUpdatedAt only (never altRec.updated, which changes on routine writes).
                            if not sourceVersion and (altRec.version ~= nil or altRec.inventoryUpdatedAt ~= nil) then
                                sourceVersion = tostring(altRec.version or "") .. ":" .. tostring(altRec.inventoryUpdatedAt or "")
                            end
                            if type(altRec.sources) == "table" then
                                local s = altRec.sources
                                local fullSources = type(s.all) == "table" or (type(s.bank) == "table" and type(s.bags) == "table" and type(s.mail) == "table")
                                if not storeChecked then
                                    -- Only use InvDB fallback when Store.IsAltComplete is unavailable; never override Store.IsAltComplete == false.
                                    if fullSources and (altRec.schemaVersion == nil or (integer(altRec.schemaVersion) and altRec.schemaVersion >= 2)) then
                                        hasCoverage = true
                                    end
                                elseif not fullSources then
                                    -- Explicit partial sources (e.g. bags-only or missing mail) always tighten coverage to false.
                                    hasCoverage = false
                                end
                            end
                        end
                    end
                    local itemsKnown = (not hadMalformed) and hasCoverage
                    -- Ultimate Bank does not expose per-container scan timestamps; mark complete=false and
                    -- sourceKind="ultimate-bank" so its public view enforces hidden-item & view-only rules immediately.
                    banks[#banks + 1] = {name = member.name, realm = realm, guildName = guildName,
                        viewOnly = viewOnly, complete = false, sourceKind = "ultimate-bank",
                        sourceVersion = sourceVersion, itemsKnown = itemsKnown, items = items}
                    seen[key] = true
                else
                    -- Even if GetAltItems failed/threw (whether viewOnly is true or false), still emit sourceKind="ultimate-bank"
                    -- with itemsKnown=false so the server clears any prior native stock that may contain hidden items.
                    banks[#banks + 1] = {name = member.name, realm = realm, guildName = guildName,
                        viewOnly = viewOnly == true, complete = false, sourceKind = "ultimate-bank", itemsKnown = false, items = {}}
                    seen[key] = true
                end
            end
        end
    end

    -- 2. Native HelpingHand scans for bank characters confirmed unmanaged by Ultimate Bank
    local nativeGuild = type(HelpingHandDB) == "table" and type(HelpingHandDB.nativeBanks) == "table" and HelpingHandDB.nativeBanks[guildName] or nil
    if type(nativeGuild) == "table" then
        for charName, rec in pairs(nativeGuild) do
            local key = text(charName) and charName:lower() or nil
            if type(rec) == "table" and key and not seen[key] and not ubManaged[key] then
                -- If Ultimate Bank is loaded at all, require confirmed guild metadata AND explicit G.IsBank == false
                -- before exporting native stock, so private items cannot leak if Ultimate Bank metadata is temporarily unavailable.
                local ubSafe = true
                if type(G) == "table" then
                    if type(G.IsBank) == "function" and type(G.Info) == "table" and H.Plain(G.Info.name) == guildName then
                        local managed = H.Call(G.IsBank, G, charName)
                        if managed ~= false then ubSafe = false end
                    else
                        ubSafe = false
                    end
                end
                if ubSafe then
                    local items = mergeNativeBankItems(rec)
                    local bagsAt = integer(rec.bagsScannedAt)
                    local bankAt = integer(rec.bankScannedAt)
                    local mailAt = integer(rec.mailScannedAt)
                    local complete = type(rec.bags) == "table" and type(rec.bank) == "table" and type(rec.mail) == "table"
                        and bagsAt ~= nil and bagsAt > 0 and bankAt ~= nil and bankAt > 0 and mailAt ~= nil and mailAt > 0
                    -- Use the oldest scan timestamp across all scanned containers (including empty mailbox scans).
                    local observed = nil
                    local function consider(ts)
                        if ts and ts > 0 then
                            observed = observed and math.min(observed, ts) or ts
                        end
                    end
                    if type(rec.bags) == "table" then consider(bagsAt) end
                    if type(rec.bank) == "table" then consider(bankAt) end
                    if type(rec.mail) == "table" then consider(mailAt) end
                    banks[#banks + 1] = {
                        name = charName, realm = text(rec.realm) or realm, guildName = guildName,
                        viewOnly = rec.viewOnly == true, complete = complete, sourceKind = "native",
                        observedAt = observed, items = items
                    }
                    seen[key] = true
                end
            end
        end
    end

    return #banks > 0 and banks or nil
end

function H.BankLog(guildName)
    local out = {}
    local localLog = type(HelpingHandDB) == "table" and type(HelpingHandDB.localBankLog) == "table" and HelpingHandDB.localBankLog or nil
    if localLog then
        for _, e in ipairs(localLog) do
            if type(e) == "table" and (not e.guild or e.guild == guildName) and text(e.type) and integer(e.ts) and e.ts > 0 and text(e.name) then
                out[#out + 1] = {
                    type = e.type, ts = e.ts, name = e.name, from = text(e.from), to = text(e.to),
                    itemId = integer(e.itemId) and e.itemId > 0 and e.itemId or nil,
                    suffixId = integer(e.suffixId) or 0, item = text(e.item),
                    count = integer(e.count) and e.count >= 0 and e.count or nil,
                    money = integer(e.money) and e.money >= 0 and e.money or nil,
                    vendorPrice = integer(e.vendorPrice) and e.vendorPrice >= 0 and e.vendorPrice or nil,
                    note = text(e.note),
                }
            end
        end
    end
    local Log = TOGBankClassic_Log
    if type(Log) == "table" and type(Log.GetEntries) == "function" then
        local entries = H.Call(Log.GetEntries, Log, {limit = 250})
        if type(entries) == "table" then
            for _, e in ipairs(entries) do
                if type(e) == "table" and text(e.type) and integer(e.ts) and e.ts > 0 and text(e.name) then
                    local itemID = integer(e.itemID)
                    local vendorPrice = nil
                    if itemID and itemID > 0 and GetItemInfo then
                        local _, _, _, _, _, _, _, _, _, _, sellPrice = H.Call(GetItemInfo, itemID)
                        if integer(sellPrice) and sellPrice >= 0 then vendorPrice = sellPrice end
                    end
                    out[#out + 1] = {
                        type = e.type,
                        ts = e.ts,
                        name = e.name,
                        from = text(e.from),
                        to = text(e.to),
                        itemId = itemID and itemID > 0 and itemID or nil,
                        suffixId = integer(e.suffixID) or 0,
                        item = text(e.item),
                        count = integer(e.count) and e.count >= 0 and e.count or nil,
                        money = integer(e.money) and e.money >= 0 and e.money or nil,
                        vendorPrice = vendorPrice,
                        requestId = text(e.requestId),
                        note = text(e.note),
                    }
                end
            end
        end
    end
    return #out > 0 and out or nil
end

function H.GuildMeta()
    local motd = text(H.Call(GetGuildRosterMOTD))
    local infoText = text(H.Call(GetGuildInfoText))
    if not motd and not infoText then return nil end
    return {motd = motd, infoText = infoText}
end

function H.Collect(includeGuild)
    local identity = H.Identity()
    local guildName = H.Call(GetGuildInfo, "player")
    if not identity or not text(identity.guid) or not text(guildName) then return nil, "Join the guild and wait for character data before capture." end
    local region = H.Call(GetCurrentRegion)
    local regions = {[1] = "us", [2] = "kr", [3] = "eu", [4] = "tw", [5] = "cn"}
    if not regions[region] then return nil, "The client could not identify your region." end
    local character = {name = identity.name, realm = identity.realm, guid = identity.guid,
        level = H.Call(UnitLevel, "player"), className = H.Call(UnitClass, "player"), professions = H.Professions()}
    local snapshot = {schemaVersion = 1, capturedAt = H.Call(GetServerTime) or H.Call(time),
        source = {addonVersion = H.version, character = identity,
            guild = {name = guildName, realm = identity.realm, region = regions[region]}}, characters = {character}}
    if includeGuild then
        local roster = H.Roster(identity.realm)
        snapshot.banks = H.Banks(guildName, identity.realm, roster)
        snapshot.bankLog = H.BankLog(guildName)
        for _, member in ipairs(roster.members) do member.isGbank = nil end
        snapshot.roster = roster
        snapshot.guildMeta = H.GuildMeta()
    end
    return snapshot
end
