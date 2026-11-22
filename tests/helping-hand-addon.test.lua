local root = ...
local env = setmetatable({}, {__index = _G})
env.HelpingHandDB = {}
env.UnitName = function() return "First", "Surname" end
env.RegionalUniqueNamesEnabled = function() return true end
env.GetRealmName = function() return "Realm" end
env.UnitGUID = function() return "Player-test" end
env.GetGuildInfo = function() return "Guild", "Owner", 0 end
env.GetCurrentRegion = function() return 1 end
env.GetServerTime = function() return 1700000000 end
env.UnitLevel = function() return 30 end
env.UnitClass = function() return "Mage" end
env.GetNumGuildMembers = function() return 2 end
env.GetGuildRosterInfo = function(i)
    if i == 1 then return "First Surname", "Owner", 0, 30, "Mage" end
    return "Bank Surname", "Member", 3, 20, "Warrior"
end
assert(loadfile(root .. "/addon/HelpingHand/Core.lua", "t", env))()
assert(loadfile(root .. "/addon/HelpingHand/Collect.lua", "t", env))()
local H = env.HelpingHand
H.Initialize()
assert(H.Identity().name == "First Surname")
assert(H.Capture(false))
assert(env.HelpingHandDB.outbox.roster == nil)
assert(env.HelpingHandDB.outbox.banks == nil)
assert(env.HelpingHandDB.outbox.token == nil)
assert(env.HelpingHandDB.outbox.characters[1].name == "First Surname")
local previous = env.HelpingHandDB.outbox.snapshotId
assert(H.Capture(false))
assert(env.HelpingHandDB.outbox.snapshotId ~= previous)
local calls = 0
env.TOGBankClassic_Guild = {
    Info = {name = "Guild"},
    IsBank = function(_, name) return name == "Bank Surname" end,
    IsViewOnlyBank = function() return true end,
    GetAltItems = function()
        calls = calls + 1
        return {{ID = 118, Count = 20, Suffix = -12, Enchant = 33, Info = {name = "Potion", rarity = 1}},
            {ID = 999, Count = 1, Hidden = true}}
    end,
    GetAltItemsWithOwnHidden = function() error("Never read private stock") end,
}
env.TOGBankClassic_Inventory_Store = {
    HasAlt = function(_, guildName, altName) return guildName == "Guild" and altName == "Bank Surname" end,
    IsAltComplete = function(_, guildName, altName) return guildName == "Guild" and altName == "Bank Surname" end,
}
assert(H.Capture(true))
local bank = env.HelpingHandDB.outbox.banks[1]
assert(bank.viewOnly and bank.sourceKind == "ultimate-bank" and bank.itemsKnown == true and bank.complete == false)
assert(bank.observedAt == nil)
assert(#bank.items == 1 and bank.items[1].itemId == 118)
assert(bank.items[1].suffixId == -12 and bank.items[1].enchantId == 33)
assert(calls == 1)
env.TOGBankClassic_Guild.GetAltItems = function() return {{ID = 118, Count = -1}} end
assert(H.Capture(true))
assert(env.HelpingHandDB.outbox.banks[1].itemsKnown == false)
env.TOGBankClassic_Guild.GetAltItems = function()
    return {{ID = 118, Count = 20}, "malformed row"}
end
assert(H.Capture(true))
assert(env.HelpingHandDB.outbox.banks[1].itemsKnown == false, "Malformed rows must preserve prior stock")
assert(#env.HelpingHandDB.outbox.banks[1].items == 1)
env.TOGBankClassic_Guild.GetAltItems = function()
    return {[1] = {ID = 118, Count = 20}, [3] = {ID = 999, Count = 2}}
end
assert(H.Capture(true))
assert(env.HelpingHandDB.outbox.banks[1].itemsKnown == false, "Sparse rows must preserve prior stock")
assert(#env.HelpingHandDB.outbox.banks[1].items == 2, "Keep valid records after a hole")
env.TOGBankClassic_Guild.GetAltItems = function() return {} end
assert(H.Capture(true))
assert(#env.HelpingHandDB.outbox.banks[1].items == 0)
assert(env.HelpingHandDB.outbox.banks[1].itemsKnown == true)
env.TOGBankClassic_Inventory_Store.IsAltComplete = function() return false end
assert(H.Capture(true))
assert(env.HelpingHandDB.outbox.banks[1].itemsKnown == false)
env.TOGBankClassic_Guild.GetAltItems = function() error("Unavailable") end
assert(H.Capture(true))
assert(env.HelpingHandDB.outbox.banks[1].viewOnly == true and env.HelpingHandDB.outbox.banks[1].itemsKnown == false)
env.GetGuildRosterMOTD = function() return "Raid night Friday!" end
env.GetGuildInfoText = function() return "Be kind and help each other." end
env.GetGuildInfo = function() return "Guild", "Member", 3 end
assert(H.Capture(true))
assert(env.HelpingHandDB.outbox.guildMeta.motd == "Raid night Friday!")
assert(env.HelpingHandDB.outbox.guildMeta.infoText == "Be kind and help each other.")
env.C_SkillInfo = {GetSkillLineInfoByID = function(id)
    if id == 171 then return {name = "Alchemy", rank = 150, maxRank = 225} end
end}
env.C_TradeSkillUI = {
    IsTradeSkillReady = function() return true end,
    IsTradeSkillLinked = function() return false end,
    IsTradeSkillGuild = function() return false end,
    IsTradeSkillGuildMember = function() return false end,
    IsNPCCrafting = function() return false end,
    GetBaseProfessionInfo = function() return {professionID = 171} end,
    GetAllRecipeIDs = function() return {2330, 999} end,
    GetRecipeInfo = function(id) return {name = "Potion", learned = id == 2330} end,
    GetRecipeItemLink = function() return "item:118" end,
}
assert(#H.Professions()[1].recipes == 1)
env.C_TradeSkillUI.IsTradeSkillLinked = function() return true end
assert(H.Professions()[1].recipes == nil)
env.C_TradeSkillUI.IsTradeSkillLinked = function() return false end
env.C_TradeSkillUI.GetAllRecipeIDs = function() error("Incomplete") end
assert(H.Professions()[1].recipes == nil)
print("Helping Hand collector checks passed.")
