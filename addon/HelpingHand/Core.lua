HelpingHand = { version = "0.1.1" }
local H = HelpingHand

function H.Plain(value)
    if issecretvalue and issecretvalue(value) then return nil end
    return value
end

function H.SafeCall(fn, ...)
    if type(fn) ~= "function" then return false end
    local ok, a, b, c, d, e, f, g, h, i, j = pcall(fn, ...)
    if not ok then return false end
    return true, H.Plain(a), H.Plain(b), H.Plain(c), H.Plain(d), H.Plain(e),
           H.Plain(f), H.Plain(g), H.Plain(h), H.Plain(i), H.Plain(j)
end

function H.Call(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c, d, e, f, g, h, i, j = pcall(fn, ...)
    if ok then
        return H.Plain(a), H.Plain(b), H.Plain(c), H.Plain(d), H.Plain(e),
               H.Plain(f), H.Plain(g), H.Plain(h), H.Plain(i), H.Plain(j)
    end
end

function H.Initialize()
    if type(HelpingHandDB) ~= "table" then HelpingHandDB = {} end
    HelpingHandDB.sequence = tonumber(HelpingHandDB.sequence) or 0
    if type(HelpingHandDB.localBankLog) ~= "table" then HelpingHandDB.localBankLog = {} end
    if type(HelpingHandDB.nativeBanks) ~= "table" then HelpingHandDB.nativeBanks = {} end
    if type(HelpingHandDB.iconPos) ~= "table" then HelpingHandDB.iconPos = nil end
end

function H.Capture(includeGuild)
    H.Initialize()
    local ok, snapshot, message = pcall(H.Collect, includeGuild)
    if not ok then return false, "Capture failed. Open your guild and profession windows, then try again." end
    if not snapshot then return false, message end
    HelpingHandDB.sequence = HelpingHandDB.sequence + 1
    snapshot.snapshotId = snapshot.source.character.guid .. ":" .. snapshot.capturedAt .. ":" .. HelpingHandDB.sequence
    snapshot.source.character.guid = nil
    HelpingHandDB.outbox = snapshot
    H.needsReload = true
    if H.UpdateStatusIcon then pcall(H.UpdateStatusIcon) end
    return true, "Capture ready. Use /reload to sync with the desktop app."
end

local activeTrade = nil
local bankFrameOpen = false
local mailHooksInstalled = false

local function parseLinkIds(link)
    if type(link) ~= "string" then return nil, 0, 0 end
    local itemStr = link:match("item:([^|]+)")
    if not itemStr then return nil, 0, 0 end
    local parts = {}
    for p in (itemStr .. ":"):gmatch("([^:]*):") do parts[#parts + 1] = p end
    local id = tonumber(parts[1])
    local enchant = tonumber(parts[2]) or 0
    local suffix = tonumber(parts[7]) or 0
    return id, suffix, enchant
end

local function itemMeta(itemId)
    if not itemId or not GetItemInfo then return nil, nil, nil end
    local name, _, quality, _, _, _, _, _, _, _, sellPrice = H.Call(GetItemInfo, itemId)
    local vp = type(sellPrice) == "number" and sellPrice >= 0 and math.floor(sellPrice) or nil
    local q = type(quality) == "number" and math.floor(quality) or nil
    return type(name) == "string" and name or nil, q, vp
end

local function isCurrentCharBank()
    local G = TOGBankClassic_Guild
    local id = H.Identity and H.Identity()
    if not id or not id.name then return false end
    if type(G) == "table" and type(G.IsBank) == "function" then
        if H.Call(G.IsBank, G, id.name) == true then return true end
    end
    local count = H.Call(GetNumGuildMembers) or 0
    local lower = id.name:lower()
    for i = 1, math.min(count, 2000) do
        local name, _, _, _, _, _, pub, off = H.Call(GetGuildRosterInfo, i)
        if type(name) == "string" then
            local short = name:match("^(.-)%-.+$") or name
            if short:lower() == lower then
                local notes = ((type(pub) == "string" and pub or "") .. " " .. (type(off) == "string" and off or "")):lower()
                return notes:find("gbank", 1, true) ~= nil
            end
        end
    end
    return false
end

local function ensureNativeBankRecord()
    if not isCurrentCharBank() then return nil end
    local id = H.Identity and H.Identity()
    local guildName = H.Call(GetGuildInfo, "player")
    if not id or not id.name or type(guildName) ~= "string" or guildName == "" then return nil end
    H.Initialize()
    if type(HelpingHandDB.nativeBanks[guildName]) ~= "table" then HelpingHandDB.nativeBanks[guildName] = {} end
    local rec = HelpingHandDB.nativeBanks[guildName][id.name]
    if type(rec) ~= "table" then
        rec = { name = id.name, realm = id.realm, guildName = guildName, viewOnly = false }
        HelpingHandDB.nativeBanks[guildName][id.name] = rec
    end
    rec.realm = id.realm
    return rec
end

local function scanContainers(bagIds)
    local C = C_Container
    local getSlots = (C and C.GetContainerNumSlots) or GetContainerNumSlots
    local getInfo = C and C.GetContainerItemInfo
    local getLink = (C and C.GetContainerItemLink) or GetContainerItemLink
    if not getSlots then return nil end
    local out = {}
    for _, bag in ipairs(bagIds) do
        local okSlots, slots = H.SafeCall(getSlots, bag)
        if not okSlots or type(slots) ~= "number" or slots < 0 then return nil end
        for slot = 1, slots do
            local link, count, itemId, quality
            if getInfo then
                local okInfo, info = H.SafeCall(getInfo, bag, slot)
                if not okInfo then return nil end
                if type(info) == "table" then
                    link = info.hyperlink
                    count = info.stackCount
                    itemId = info.itemID
                    quality = info.quality
                end
            elseif GetContainerItemInfo then
                local okInfo, _, c, _, q, _, _, l, _, _, id = H.SafeCall(GetContainerItemInfo, bag, slot)
                if not okInfo then return nil end
                count, quality, link, itemId = c, q, l, id
            end
            if not link and getLink then
                local okLink, l = H.SafeCall(getLink, bag, slot)
                if not okLink then return nil end
                link = l
            end
            local parsedId, suffix, enchant = parseLinkIds(link)
            itemId = itemId or parsedId
            if type(itemId) == "number" and itemId > 0 and type(count) == "number" and count > 0 then
                local name, metaQ, vp = itemMeta(itemId)
                out[#out + 1] = {
                    itemId = math.floor(itemId), suffixId = suffix, enchantId = enchant,
                    count = math.floor(count), name = name or ("Item #" .. math.floor(itemId)),
                    quality = quality or metaQ, vendorPrice = vp
                }
            end
        end
    end
    return out
end

local function notifyStatusUI()
    if H.UpdateStatusIcon then pcall(H.UpdateStatusIcon) end
end

local function formatAge(ts, nowTs)
    if type(ts) ~= "number" or ts <= 0 then return "never" end
    local diff = math.max(0, (nowTs or 0) - ts)
    if diff < 60 then return "just now" end
    if diff < 3600 then return math.floor(diff / 60) .. "m ago" end
    if diff < 86400 then return math.floor(diff / 3600) .. "h ago" end
    return math.floor(diff / 86400) .. "d ago"
end

function H.BankSyncStatus()
    H.Initialize()
    local nowTs = H.Call(GetServerTime) or H.Call(time) or 0
    local guildName = H.Call(GetGuildInfo, "player")
    local onBank = isCurrentCharBank()
    local staleSec = 12 * 3600
    local lines = {}

    if type(guildName) ~= "string" or guildName == "" then
        return { state = "ok", badge = "HH", summary = "Not in a guild.", lines = lines }
    end

    local nativeGuild = type(HelpingHandDB.nativeBanks) == "table" and HelpingHandDB.nativeBanks[guildName] or nil
    local bankCount, newestBankTs, newestMailTs = 0, 0, 0
    if type(nativeGuild) == "table" then
        for charName, rec in pairs(nativeGuild) do
            if type(rec) == "table" then
                bankCount = bankCount + 1
                local bTs = tonumber(rec.bankScannedAt) or 0
                local mTs = tonumber(rec.mailScannedAt) or 0
                local bagTs = tonumber(rec.bagsScannedAt) or 0
                newestBankTs = math.max(newestBankTs, bTs, bagTs)
                newestMailTs = math.max(newestMailTs, mTs)
                lines[#lines + 1] = charName .. ": bank " .. formatAge(bTs, nowTs) .. ", mail " .. formatAge(mTs, nowTs)
            end
        end
    end

    if H.needsReload then
        return {
            state = "reload",
            badge = "RL",
            summary = "New data captured — /reload to sync to website.",
            lines = lines
        }
    end

    if onBank then
        local id = H.Identity and H.Identity()
        local rec = id and id.name and nativeGuild and nativeGuild[id.name] or nil
        local hasBank = rec and tonumber(rec.bankScannedAt) and (nowTs - rec.bankScannedAt) < staleSec
        local hasMail = rec and tonumber(rec.mailScannedAt) and (nowTs - rec.mailScannedAt) < staleSec
        if not hasBank or not hasMail then
            local missing = {}
            if not hasBank then missing[#missing + 1] = "bank vault" end
            if not hasMail then missing[#missing + 1] = "mailbox" end
            return {
                state = "action",
                badge = "!",
                summary = "Open " .. table.concat(missing, " & ") .. " on this bank character.",
                lines = lines
            }
        end
        if H.bankDirty then
            return {
                state = "reload",
                badge = "RL",
                summary = "Bank scanned — /reload or log out to sync.",
                lines = lines
            }
        end
        return { state = "ok", badge = "OK", summary = "Bank character is up to date.", lines = lines }
    end

    if bankCount == 0 then
        return {
            state = "action",
            badge = "!",
            summary = "Log in to your bank character to scan bank & mail.",
            lines = lines
        }
    end

    if (nowTs - newestBankTs) > staleSec or (nowTs - newestMailTs) > staleSec then
        return {
            state = "action",
            badge = "!",
            summary = "Bank scan is over 12h old — log in to bank alt to refresh.",
            lines = lines
        }
    end

    return { state = "ok", badge = "OK", summary = "Bank data is up to date.", lines = lines }
end

function H.ScanOwnBags()
    local rec = ensureNativeBankRecord()
    if not rec then return end
    local items = scanContainers({0, 1, 2, 3, 4})
    if items then
        rec.bags = items
        rec.bagsScannedAt = H.Call(GetServerTime) or H.Call(time) or 0
        H.bankDirty = true
        notifyStatusUI()
    end
end

function H.ScanOwnBank()
    if not bankFrameOpen then return end
    local rec = ensureNativeBankRecord()
    if not rec then return end
    local bagIds = {-1, 5, 6, 7, 8, 9, 10, 11}
    local items = scanContainers(bagIds)
    if items then
        rec.bank = items
        rec.bankScannedAt = H.Call(GetServerTime) or H.Call(time) or 0
        H.bankDirty = true
        notifyStatusUI()
    end
end

function H.ScanOwnMail()
    local rec = ensureNativeBankRecord()
    if not rec or not GetInboxNumItems then return end
    local okNum, num, total = H.SafeCall(GetInboxNumItems)
    if not okNum or type(num) ~= "number" or num < 0 then return end
    -- In WoW Classic, GetInboxNumItems() returns (numItems, totalItems); abort if mailbox has more items than loaded.
    if type(total) == "number" and total > num then return end
    local out = {}
    for i = 1, num do
        for attach = 1, 12 do
            local okItem, name, itemId, _, count = H.SafeCall(GetInboxItem, i, attach)
            if not okItem then return end
            local link = nil
            if GetInboxItemLink then
                local okLink, l = H.SafeCall(GetInboxItemLink, i, attach)
                if not okLink then return end
                link = l
            end
            local parsedId, suffix, enchant = parseLinkIds(link)
            itemId = itemId or parsedId
            if type(itemId) == "number" and itemId > 0 and type(count) == "number" and count > 0 then
                local metaName, metaQ, vp = itemMeta(itemId)
                out[#out + 1] = {
                    itemId = math.floor(itemId), suffixId = suffix, enchantId = enchant,
                    count = math.floor(count), name = (type(name) == "string" and name ~= "" and name) or metaName or ("Item #" .. math.floor(itemId)),
                    quality = metaQ, vendorPrice = vp
                }
            end
        end
    end
    rec.mail = out
    rec.mailScannedAt = H.Call(GetServerTime) or H.Call(time) or 0
    H.bankDirty = true
    notifyStatusUI()
end

local function recordLocalEntry(entry)
    H.Initialize()
    local log = HelpingHandDB.localBankLog
    table.insert(log, 1, entry)
    while #log > 500 do table.remove(log) end
end

local function installMailHooks()
    if mailHooksInstalled or not hooksecurefunc then return end
    mailHooksInstalled = true
    if TakeInboxItem then
        hooksecurefunc("TakeInboxItem", function(mailIndex, attachIndex)
            if not isCurrentCharBank() then return end
            local id = H.Identity and H.Identity()
            local guildName = H.Call(GetGuildInfo, "player")
            if not id or not id.name or type(guildName) ~= "string" or guildName == "" then return end
            local _, _, sender, _, _, codAmount = H.Call(GetInboxHeaderInfo, mailIndex)
            if type(codAmount) == "number" and codAmount > 0 then return end
            local name, itemId, _, count = H.Call(GetInboxItem, mailIndex, attachIndex or 1)
            local link = GetInboxItemLink and H.Call(GetInboxItemLink, mailIndex, attachIndex or 1) or nil
            local parsedId, suffix = parseLinkIds(link)
            itemId = itemId or parsedId
            if type(itemId) == "number" and itemId > 0 and type(count) == "number" and count > 0 then
                local metaName, _, vp = itemMeta(itemId)
                recordLocalEntry({
                    guild = guildName, type = "deposit", ts = H.Call(GetServerTime) or H.Call(time) or 0,
                    name = id.name, from = type(sender) == "string" and sender ~= "" and sender or nil,
                    itemId = math.floor(itemId), suffixId = suffix,
                    item = (type(name) == "string" and name ~= "" and name) or metaName or ("Item #" .. math.floor(itemId)),
                    count = math.floor(count), vendorPrice = vp, note = "Mail"
                })
            end
        end)
    end
    if TakeInboxMoney then
        hooksecurefunc("TakeInboxMoney", function(mailIndex)
            if not isCurrentCharBank() then return end
            local id = H.Identity and H.Identity()
            local guildName = H.Call(GetGuildInfo, "player")
            if not id or not id.name or type(guildName) ~= "string" or guildName == "" then return end
            local _, _, sender, _, money = H.Call(GetInboxHeaderInfo, mailIndex)
            if type(money) == "number" and money > 0 then
                recordLocalEntry({
                    guild = guildName, type = "money-deposit", ts = H.Call(GetServerTime) or H.Call(time) or 0,
                    name = id.name, from = type(sender) == "string" and sender ~= "" and sender or nil,
                    money = math.floor(money), note = "Mail"
                })
            end
        end)
    end
end

local function snapshotTrade()
    if not activeTrade then return end
    activeTrade.items = {}
    for slot = 1, 6 do
        local name, _, count = H.Call(GetTradeTargetItemInfo, slot)
        local link = H.Call(GetTradeTargetItemLink, slot)
        if type(name) == "string" and name ~= "" and type(count) == "number" and count > 0 then
            local itemId = parseLinkIds(link)
            local _, _, vp = itemMeta(itemId)
            activeTrade.items[#activeTrade.items + 1] = {
                itemId = itemId, item = name, count = math.floor(count), vendorPrice = vp
            }
        end
    end
    local money = H.Call(GetTargetTradeMoney)
    activeTrade.money = type(money) == "number" and money > 0 and math.floor(money) or 0
end

local function commitTrade()
    if not activeTrade or not isCurrentCharBank() then activeTrade = nil; return end
    local id = H.Identity and H.Identity()
    local guildName = H.Call(GetGuildInfo, "player")
    if not id or not id.name or type(guildName) ~= "string" or guildName == "" then activeTrade = nil; return end
    local ts = H.Call(GetServerTime) or H.Call(time) or 0
    for _, it in ipairs(activeTrade.items or {}) do
        recordLocalEntry({
            guild = guildName, type = "deposit", ts = ts, name = id.name, from = activeTrade.partner,
            itemId = it.itemId, item = it.item, count = it.count, vendorPrice = it.vendorPrice,
            note = "In-person trade"
        })
    end
    if activeTrade.money and activeTrade.money > 0 then
        recordLocalEntry({
            guild = guildName, type = "money-deposit", ts = ts, name = id.name, from = activeTrade.partner,
            money = activeTrade.money, note = "In-person trade"
        })
    end
    activeTrade = nil
end

local events = CreateFrame and CreateFrame("Frame")
if events then
    for _, ev in ipairs({
        "ADDON_LOADED", "PLAYER_ENTERING_WORLD", "GUILD_ROSTER_UPDATE",
        "BAG_UPDATE_DELAYED", "BANKFRAME_OPENED", "BANKFRAME_CLOSED",
        "PLAYERBANKSLOTS_CHANGED", "MAIL_SHOW", "MAIL_INBOX_UPDATE",
        "TRADE_SHOW", "TRADE_TARGET_ITEM_CHANGED", "TRADE_MONEY_CHANGED",
        "TRADE_ACCEPT_UPDATE", "TRADE_CLOSED", "UI_INFO_MESSAGE", "PLAYER_LOGOUT"
    }) do
        pcall(events.RegisterEvent, events, ev)
    end
    events:SetScript("OnEvent", function(_, event, arg1, arg2)
        if event == "ADDON_LOADED" and arg1 == "HelpingHand" then
            H.Initialize()
            installMailHooks()
            if H.InitStatusIcon then pcall(H.InitStatusIcon) end
        elseif event == "PLAYER_ENTERING_WORLD" or event == "GUILD_ROSTER_UPDATE" then
            if H.InitStatusIcon then pcall(H.InitStatusIcon) end
            notifyStatusUI()
        elseif event == "BAG_UPDATE_DELAYED" then
            H.ScanOwnBags()
            if bankFrameOpen then H.ScanOwnBank() end
        elseif event == "BANKFRAME_OPENED" then
            bankFrameOpen = true
            H.ScanOwnBags()
            H.ScanOwnBank()
        elseif event == "PLAYERBANKSLOTS_CHANGED" then
            if bankFrameOpen then H.ScanOwnBank() end
        elseif event == "BANKFRAME_CLOSED" then
            bankFrameOpen = false
        elseif event == "MAIL_SHOW" or event == "MAIL_INBOX_UPDATE" then
            installMailHooks()
            H.ScanOwnMail()
        elseif event == "TRADE_SHOW" then
            local partner = H.Call(UnitName, "npc")
            if type(partner) == "string" and partner ~= "" then
                activeTrade = { partner = partner, items = {}, money = 0 }
                snapshotTrade()
            end
        elseif event == "TRADE_TARGET_ITEM_CHANGED" or event == "TRADE_MONEY_CHANGED" or event == "TRADE_ACCEPT_UPDATE" then
            snapshotTrade()
        elseif event == "UI_INFO_MESSAGE" and arg2 == ERR_TRADE_COMPLETE then
            commitTrade()
        elseif event == "TRADE_CLOSED" then
            activeTrade = nil
        elseif event == "PLAYER_LOGOUT" then
            H.ScanOwnBags()
            pcall(H.Capture, H.IsOwner() or isCurrentCharBank())
        end
    end)
end
