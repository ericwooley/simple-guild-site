HelpingHand = { version = "0.1.0" }
local H = HelpingHand

function H.Plain(value)
    if issecretvalue and issecretvalue(value) then return nil end
    return value
end

function H.Call(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, a, b, c, d, e = pcall(fn, ...)
    if ok then return H.Plain(a), H.Plain(b), H.Plain(c), H.Plain(d), H.Plain(e) end
end

function H.Initialize()
    if type(HelpingHandDB) ~= "table" then HelpingHandDB = {} end
    HelpingHandDB.sequence = tonumber(HelpingHandDB.sequence) or 0
end

function H.SaveToken(token)
    token = type(token) == "string" and token:match("^%s*(.-)%s*$") or ""
    if #token > 4096 or not token:match("^[A-Za-z0-9_-]+%.[A-Za-z0-9_-]+%.[A-Za-z0-9_-]+$") then
        return false, "Paste a valid sync token from Addon Sync."
    end
    HelpingHandDB.token = token
    return true, "Token configured. Capture data, then use /reload and the bridge."
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
    return true, "Capture ready. Use /reload, then run the website bridge."
end

local events = CreateFrame and CreateFrame("Frame")
if events then
    events:RegisterEvent("ADDON_LOADED")
    events:SetScript("OnEvent", function(_, _, name)
        if name == "HelpingHand" then H.Initialize() end
    end)
end
