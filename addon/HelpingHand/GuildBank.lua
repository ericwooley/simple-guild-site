local H = HelpingHand
local open = false
local pendingTabs = {}
local pendingLogs = {}

local function currentGuild()
    local name = H.Call(GetGuildInfo, "player")
    local identity = H.Identity()
    if type(name) ~= "string" or not identity then return nil end
    H.Initialize()
    HelpingHandDB.guildBank = HelpingHandDB.guildBank or {}
    local key = name .. ":" .. identity.realm
    HelpingHandDB.guildBank[key] = HelpingHandDB.guildBank[key] or {tabs = {}, logs = {}}
    return HelpingHandDB.guildBank[key], name, identity.realm
end

local function itemFromLink(link, count)
    if type(link) ~= "string" or type(count) ~= "number" or count < 1 then return nil end
    local parts = {}
    local value = link:match("item:([^|]+)")
    if not value then return nil end
    for field in (value .. ":"):gmatch("([^:]*):") do parts[#parts + 1] = field end
    local id = tonumber(parts[1])
    if not id or id < 1 then return nil end
    local name, _, quality = H.Call(GetItemInfo, link)
    return {itemId = id, suffixId = tonumber(parts[7]) or 0, enchantId = tonumber(parts[2]) or 0,
        count = count, name = name or ("Item #" .. id), quality = quality}
end

function H.ReadGuildBankTab(tab)
    if not open or not pendingTabs[tab] then return end
    local cache, guildName, realm = currentGuild()
    local tabName, _, viewable, _, withdrawals = H.Call(GetGuildBankTabInfo, tab)
    if not cache or viewable ~= true then return end
    local items, byKey = {}, {}
    for slot = 1, 98 do
        local ok, texture, count = H.SafeCall(GetGuildBankItemInfo, tab, slot)
        if not ok then return end
        if texture then
            local item = itemFromLink(H.Call(GetGuildBankItemLink, tab, slot), count)
            if not item then return end
            local key = item.itemId .. ":" .. item.suffixId .. ":" .. item.enchantId
            if byKey[key] then
                byKey[key].count = byKey[key].count + item.count
            else
                byKey[key] = item
                items[#items + 1] = item
            end
        end
    end
    cache.tabs[tab] = {name = "Guild bank tab " .. tab, realm = realm, guildName = guildName,
        sourceKind = "guild-bank", guildTabId = tab, guildTabName = tabName or ("Tab " .. tab),
        complete = true, observedAt = H.Call(GetServerTime), viewOnly = withdrawals == 0, items = items}
    H.needsReload = true
end

local function ageSeconds(years, months, days, hours)
    if type(years) ~= "number" or type(months) ~= "number"
        or type(days) ~= "number" or type(hours) ~= "number" then return nil end
    return math.floor((((years * 365 + months * 30 + days) * 24) + hours) * 3600)
end

function H.ReadGuildBankLog(tab)
    if not open or not pendingLogs[tab] then return end
    local cache = currentGuild()
    if not cache then return end
    local count = H.Call(GetNumGuildBankTransactions, tab)
    if type(count) ~= "number" or count < 0 or count > 1000 then return end
    local entries = {}
    for index = 1, count do
        local kind, actor, link, quantity, fromTab, toTab, years, months, days, hours =
            H.Call(GetGuildBankTransaction, tab, index)
        local item = itemFromLink(link, quantity)
        local age = ageSeconds(years, months, days, hours)
        if not item or not age or type(actor) ~= "string"
            or (kind ~= "deposit" and kind ~= "withdraw" and kind ~= "move") then return end
        entries[#entries + 1] = {type = kind, actor = actor, itemId = item.itemId, itemName = item.name,
            count = quantity, ageSeconds = age, fromTab = fromTab, toTab = toTab}
    end
    cache.logs[tab] = {tabId = tab, observedAt = H.Call(GetServerTime), entries = entries}
    H.needsReload = true
end

function H.QueryGuildBank()
    if not open then return end
    local tabs = H.Call(GetNumGuildBankTabs) or 0
    for tab = 1, math.min(tabs, 8) do
        local _, _, viewable = H.Call(GetGuildBankTabInfo, tab)
        if viewable == true then
            pendingTabs[tab] = true
            pendingLogs[tab] = true
            H.Call(QueryGuildBankTab, tab)
            H.Call(QueryGuildBankLog, tab)
        end
    end
end

function H.GuildBankExport()
    local cache = currentGuild()
    if not cache then return {}, nil end
    local tabs, logs = {}, {}
    local count = H.Call(GetNumGuildBankTabs) or 0
    for tab = 1, math.min(count, 8) do
        local _, _, viewable = H.Call(GetGuildBankTabInfo, tab)
        if viewable == true then
            if cache.tabs[tab] then tabs[#tabs + 1] = cache.tabs[tab] end
            if cache.logs[tab] then logs[#logs + 1] = cache.logs[tab] end
        end
    end
    return tabs, #logs > 0 and logs or nil
end

local frame = CreateFrame and CreateFrame("Frame")
if frame then
    for _, event in ipairs({"GUILDBANKFRAME_OPENED", "GUILDBANKFRAME_CLOSED",
        "GUILDBANKBAGSLOTS_CHANGED", "GUILDBANKLOG_UPDATE", "GUILDBANK_UPDATE_TABS",
        "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", "PLAYER_INTERACTION_MANAGER_FRAME_HIDE"}) do
        pcall(frame.RegisterEvent, frame, event)
    end
    frame:SetScript("OnEvent", function(_, event, tab)
        if event == "PLAYER_INTERACTION_MANAGER_FRAME_SHOW" or event == "PLAYER_INTERACTION_MANAGER_FRAME_HIDE" then
            if not Enum or not Enum.PlayerInteractionType or tab ~= Enum.PlayerInteractionType.GuildBanker then return end
            event = event == "PLAYER_INTERACTION_MANAGER_FRAME_SHOW" and "GUILDBANKFRAME_OPENED" or "GUILDBANKFRAME_CLOSED"
        end
        if event == "GUILDBANKFRAME_OPENED" then
            open = true
            pendingTabs, pendingLogs = {}, {}
            if C_Timer and C_Timer.After then
                C_Timer.After(0.5, H.QueryGuildBank)
            else
                H.QueryGuildBank()
            end
        elseif event == "GUILDBANK_UPDATE_TABS" then
            H.QueryGuildBank()
        elseif event == "GUILDBANKFRAME_CLOSED" then
            open = false
            pendingTabs, pendingLogs = {}, {}
        elseif event == "GUILDBANKBAGSLOTS_CHANGED" then
            H.ReadGuildBankTab(tab or H.Call(GetCurrentGuildBankTab))
        elseif event == "GUILDBANKLOG_UPDATE" then
            if type(tab) == "number" then
                H.ReadGuildBankLog(tab)
            else
                for id in pairs(pendingLogs) do H.ReadGuildBankLog(id) end
            end
        end
    end)
end
