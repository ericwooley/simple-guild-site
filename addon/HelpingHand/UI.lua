local H = HelpingHand
local window, content, status, token
local tabs = {}
local function label(parent, value, x, y, width)
    local field = parent:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    field:SetPoint("TOPLEFT", x, y)
    field:SetWidth(width or 520)
    field:SetJustifyH("LEFT")
    field:SetTextColor(0.92, 0.92, 0.94)
    field:SetText(value)
    return field
end
local function button(parent, value, x, y, fn, width)
    local control = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    control:SetSize(width or 180, 32)
    control:SetPoint("TOPLEFT", x, y)
    control:SetText(value)
    control:SetScript("OnClick", fn)
    return control
end
local function clear()
    for _, child in ipairs({content:GetChildren()}) do child:Hide() end
    for _, region in ipairs({content:GetRegions()}) do region:Hide() end
end
local function capture(guild)
    local _, message = H.Capture(guild)
    status:SetText(message)
end
local function tab(name)
    clear()
    for title, control in pairs(tabs) do
        if title == name then control:LockHighlight() else control:UnlockHighlight() end
    end
    if name == "Connection" then
        label(content, "Sync token", 0, 0)
        token = CreateFrame("EditBox", nil, content, "InputBoxTemplate")
        token:SetSize(500, 36)
        token:SetPoint("TOPLEFT", 8, -32)
        token:SetAutoFocus(false)
        token:SetMaxLetters(4096)
        token:SetPassword(true)
        token:SetText(HelpingHandDB.token or "")
        token:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
        button(content, "Save token", 0, -88, function()
            local _, message = H.SaveToken(token:GetText())
            token:ClearFocus()
            status:SetText(message)
        end)
        button(content, "Clear token", 196, -88, function()
            HelpingHandDB.token = nil
            token:SetText("")
            status:SetText("Token cleared. Use /reload to save this change.")
        end)
        label(content, "Use a token from the website Addon Sync page.", 0, -152)
        label(content, "Capture data, use /reload, then run the local bridge.", 0, -184)
        status:SetText(HelpingHandDB.token and "Token configured. Website receipt unknown." or "Token required.")
    elseif name == "Characters" then
        local identity = H.Identity()
        label(content, "Character: " .. (identity and identity.name or "Unavailable"), 0, 0)
        label(content, "Realm: " .. (identity and identity.realm or "Unavailable"), 0, -28)
        local names = {}
        for _, p in ipairs(H.Professions() or {}) do names[#names + 1] = p.name .. " " .. p.rank .. "/" .. p.maxRank end
        label(content, #names > 0 and table.concat(names, "\n") or "Open your Skills window to load professions.", 0, -72)
        button(content, "Capture my data", 0, -184, function() capture(false) end)
        status:SetText("Capture sends only this character. Website verification controls access.")
    else
        if H.IsOwner() then
            label(content, "Guild roster and Ultimate Bank visible stock", 0, 0)
            label(content, "Capture includes other members. Continue only with guild consent.", 0, -48)
            label(content, "Open the guild roster first. Private items stay excluded.", 0, -96)
            button(content, "Capture guild data", 0, -184, function() capture(true) end)
            status:SetText("The website also requires a guild sync token.")
        else
            label(content, "Guild capture requires the guild owner.", 0, 0)
            status:SetText("Use Characters to capture your own data.")
        end
    end
end
function H.Toggle()
    H.Initialize()
    if window then window:SetShown(not window:IsShown()) return end
    window = CreateFrame("Frame", "HelpingHandWindow", UIParent, "BackdropTemplate")
    window:SetSize(580, 420)
    window:SetPoint("CENTER")
    window:SetMovable(true)
    window:EnableMouse(true)
    window:RegisterForDrag("LeftButton")
    window:SetScript("OnDragStart", window.StartMoving)
    window:SetScript("OnDragStop", window.StopMovingOrSizing)
    window:SetBackdrop({bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1})
    window:SetBackdropColor(0.06, 0.07, 0.09, 0.98)
    window:SetBackdropBorderColor(0.3, 0.32, 0.38, 1)
    label(window, "Helping Hand", 16, -18)
    button(window, "X", 530, -8, function() window:Hide() end, 32)
    for i, name in ipairs({"Connection", "Characters", "Guild"}) do
        tabs[name] = button(window, name, 16 + (i - 1) * 184, -56, function() tab(name) end, 176)
    end
    content = CreateFrame("Frame", nil, window)
    content:SetPoint("TOPLEFT", 24, -112)
    content:SetSize(532, 232)
    status = label(window, "", 24, -352, 532)
    tab("Connection")
end
SLASH_HELPINGHAND1 = "/hh"
SLASH_HELPINGHAND2 = "/helpinghand"
SlashCmdList.HELPINGHAND = H.Toggle
