local H = HelpingHand
local window, content, status, statusIcon, iconLabel, iconBadge
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
    if name == "Characters" then
        local identity = H.Identity()
        label(content, "Character: " .. (identity and identity.name or "Unavailable"), 0, 0)
        label(content, "Realm: " .. (identity and identity.realm or "Unavailable"), 0, -28)
        local names = {}
        for _, p in ipairs(H.Professions() or {}) do names[#names + 1] = p.name .. " " .. p.rank .. "/" .. p.maxRank end
        label(content, #names > 0 and table.concat(names, "\n") or "Open your Skills window to load professions.", 0, -72)
        button(content, "Capture my data", 0, -184, function() capture(false) end)
        status:SetText("Auto-captures on /reload or logout. Use the desktop app to sync.")
    else
        local info = H.BankSyncStatus and H.BankSyncStatus() or { summary = "Ready.", lines = {} }
        label(content, "Bank status: " .. (info.summary or "Ready."), 0, 0)
        local detailText = #(info.lines or {}) > 0 and table.concat(info.lines, "\n") or "No native bank scans recorded yet."
        label(content, detailText, 0, -34)
        label(content, "Opening bank, mail, or trades on a gbank alt records inventory & donations.", 0, -132)
        button(content, "Capture guild data", 0, -184, function() capture(true) end)
        status:SetText("Use /reload after capture. Drag the HH status icon anywhere on screen.")
    end
end

function H.UpdateStatusIcon()
    if not statusIcon or not H.BankSyncStatus then return end
    local info = H.BankSyncStatus()
    iconBadge:SetText(info.badge or "HH")
    if info.state == "action" then
        statusIcon:SetBackdropBorderColor(0.92, 0.72, 0.28, 1)
        iconBadge:SetTextColor(0.98, 0.82, 0.36)
    elseif info.state == "reload" then
        statusIcon:SetBackdropBorderColor(0.45, 0.76, 0.96, 1)
        iconBadge:SetTextColor(0.62, 0.86, 1.0)
    else
        statusIcon:SetBackdropBorderColor(0.32, 0.68, 0.42, 1)
        iconBadge:SetTextColor(0.56, 0.86, 0.62)
    end
end

function H.InitStatusIcon()
    if statusIcon or not CreateFrame or not UIParent then return end
    H.Initialize()
    statusIcon = CreateFrame("Button", "HelpingHandStatusIcon", UIParent, "BackdropTemplate")
    statusIcon:SetSize(44, 44)
    statusIcon:SetFrameStrata("MEDIUM")
    statusIcon:SetClampedToScreen(true)
    statusIcon:SetMovable(true)
    statusIcon:EnableMouse(true)
    statusIcon:RegisterForDrag("LeftButton")
    statusIcon:RegisterForClicks("LeftButtonUp")

    local pos = type(HelpingHandDB) == "table" and HelpingHandDB.iconPos or nil
    if type(pos) == "table" and pos.point and pos.x and pos.y then
        statusIcon:SetPoint(pos.point, UIParent, pos.relPoint or pos.point, pos.x, pos.y)
    else
        statusIcon:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -220, -140)
    end

    statusIcon:SetBackdrop({bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 2})
    statusIcon:SetBackdropColor(0.06, 0.07, 0.09, 0.92)
    statusIcon:SetBackdropBorderColor(0.78, 0.64, 0.37, 1)

    iconLabel = statusIcon:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    iconLabel:SetPoint("TOP", statusIcon, "TOP", 0, -5)
    iconLabel:SetTextColor(0.86, 0.78, 0.58)
    iconLabel:SetText("HH")

    iconBadge = statusIcon:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    iconBadge:SetPoint("BOTTOM", statusIcon, "BOTTOM", 0, 5)
    iconBadge:SetText("OK")

    local dragged = false
    statusIcon:SetScript("OnDragStart", function(self)
        dragged = true
        self:StartMoving()
    end)
    statusIcon:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        local point, _, relPoint, x, y = self:GetPoint()
        H.Initialize()
        HelpingHandDB.iconPos = { point = point, relPoint = relPoint, x = math.floor(x + 0.5), y = math.floor(y + 0.5) }
    end)
    statusIcon:SetScript("OnClick", function()
        if dragged then dragged = false return end
        H.Toggle()
    end)
    statusIcon:SetScript("OnEnter", function(self)
        if not GameTooltip then return end
        local info = H.BankSyncStatus and H.BankSyncStatus() or { summary = "Helping Hand", lines = {} }
        GameTooltip:SetOwner(self, "ANCHOR_LEFT")
        GameTooltip:AddLine("Helping Hand", 0.93, 0.86, 0.67)
        GameTooltip:AddLine(info.summary or "", 1, 1, 1, true)
        for _, line in ipairs(info.lines or {}) do
            GameTooltip:AddLine(line, 0.75, 0.72, 0.64)
        end
        GameTooltip:AddLine("Left-click: Open window  ·  Drag: Move icon", 0.62, 0.58, 0.50)
        GameTooltip:Show()
    end)
    statusIcon:SetScript("OnLeave", function()
        if GameTooltip then GameTooltip:Hide() end
    end)

    H.UpdateStatusIcon()
end

function H.Toggle(msg)
    H.Initialize()
    local cmd = type(msg) == "string" and msg:match("^%s*(%S+)") or nil
    if cmd == "icon" then
        H.InitStatusIcon()
        if statusIcon then
            statusIcon:ClearAllPoints()
            statusIcon:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -220, -140)
            statusIcon:Show()
            HelpingHandDB.iconPos = nil
        end
        return
    end
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
    for i, name in ipairs({"Characters", "Guild"}) do
        tabs[name] = button(window, name, 16 + (i - 1) * 184, -56, function() tab(name) end, 176)
    end
    content = CreateFrame("Frame", nil, window)
    content:SetPoint("TOPLEFT", 24, -112)
    content:SetSize(532, 232)
    status = label(window, "", 24, -352, 532)
    tab("Guild")
end

SLASH_HELPINGHAND1 = "/hh"
SLASH_HELPINGHAND2 = "/helpinghand"
SlashCmdList.HELPINGHAND = H.Toggle
