local root = ...
local passed = 0

local function environment(overrides)
  local env = {
    assert = assert, type = type, tostring = tostring, tonumber = tonumber,
    pairs = pairs, ipairs = ipairs, next = next, pcall = pcall, select = select,
    math = math, string = string, table = table,
  }
  for key, value in pairs(overrides or {}) do env[key] = value end
  env._G = env
  return env
end

local function source(path, env, ns, suffix)
  local file = assert(io.open(root .. '/vendor/addons/' .. path, 'r'))
  local text = file:read('*a')
  file:close()
  return assert(load(text .. (suffix or ''), '@' .. path, 't', env))('HelpingHand', ns)
end

local function check(name, run)
  run()
  passed = passed + 1
  print('PASS: ' .. name)
end

check('skill reads preserve unknown data under collapsed headers', function()
  local skillAPI = { GetNumSkillLines = function() return 2 end }
  local rows = {
    { isHeader = true, isCollapsed = true },
    { isHeader = false, skillID = 333, name = 'Enchanting', rank = 75, maxRank = 150 },
  }
  skillAPI.GetSkillLineInfo = function(index) return rows[index] end
  local read = source('forever-guild/Skills.read.lua', environment({ C_SkillInfo = skillAPI }), nil, '\nreturn readProfessions\n')
  local before = { [171] = { name = 'Alchemy', rank = 150, max = 225 } }
  local result = read(before)
  assert(result[171].rank == 150 and result[333].rank == 75)
  skillAPI.GetNumSkillLines = function() return 0 end
  assert(read(before) == nil)
end)

check('roster readers retain guild ranks and reject unknown members', function()
  local members = {
    { name = 'Mira', level = 35, guildRankOrder = 0, guildRank = 'Guild master', role = 1, presence = 1 },
    { name = 'Rowan', level = 30, guildRankOrder = 2, guildRank = 'Member', role = 4, presence = 3 },
  }
  local ns = { Comm = {}, ShortName = function(name) return name end, Plain = function(value) return value end }
  local env = environment({ GetTime = function() return 10 end, C_Club = {
    GetGuildClubId = function() return 100 end,
    GetClubMembers = function() return { 1, 2 } end,
    GetMemberInfo = function(_, id) return members[id] end,
  } })
  source('forever-guild/Roster.readers.lua', env, ns)
  local roster = ns.Roster.GuildMembers()
  assert(#roster == 2 and roster[1].verifiedRank == 0 and roster[2].rankName == 'Member')
  assert(ns.Roster.IsGuildmate('Mira') and not ns.Roster.IsGuildmate('Stranger'))
  assert(ns.Roster.IsOfficer('Mira') and not ns.Roster.IsOfficer('Rowan'))
  env.C_Club.GetClubMembers = function() return nil end
  ns.Roster.InvalidateGuildRoster()
  assert(not ns.Roster.IsGuildmate('Mira'))
end)

check('profession readers return supported character skill records', function()
  local ns = { L = {}, Comm = {}, Roster = {}, char = { skills = {
    [171] = { rank = 150, max = 225 },
    [333] = { rank = 75, max = 150 },
    [999] = { rank = 50, max = 75 },
  } } }
  source('forever-guild/Professions.readers.lua', environment(), ns)
  local result = ns.Professions.Mine()
  assert(#result == 2 and result[1].id == 171 and result[1].rank == 150 and result[2].id == 333)
  ns.char.skills = {}
  assert(#ns.Professions.Mine() == 0)
end)

check('recipe scans exclude unlearned recipes and preserve data after an empty read', function()
  local ns = {
    L = {}, Comm = {}, Roster = {}, Professions = { IDS = { 171 } },
    char = { skills = { [171] = { rank = 150, max = 225 } } },
    Plain = function(value) return value end, List = function(value) return value or {} end,
    Fire = function() end,
  }
  local api = {
    IsTradeSkillReady = function() return true end,
    GetBaseProfessionInfo = function() return { professionID = 171, skillLevel = 150, maxSkillLevel = 225 } end,
    GetAllRecipeIDs = function() return { 100, 200, 300 } end,
    GetRecipeInfo = function(id) return { learned = id ~= 200 } end,
    GetRecipeOutputItemData = function(id) if id == 100 then return { itemID = 2447 } end end,
  }
  source('forever-guild/Recipes.scan.lua', environment({ C_TradeSkillUI = api, time = function() return 100 end }), ns)
  ns.Recipes.Scan()
  local result = ns.char.recipes[171]
  assert(#result.items == 1 and result.items[1] == 2447 and #result.spells == 1 and result.spells[1] == 300)
  api.GetAllRecipeIDs = function() return {} end
  ns.Recipes.Scan()
  assert(ns.char.recipes[171] == result)
  api.IsTradeSkillLinked = function() return true end
  local scans = ns.Recipes.scans
  ns.Recipes.Scan()
  assert(ns.Recipes.scans == scans)
  local decoded = assert(ns.Recipes.Decode(ns.Recipes.Encode({ 300, 100, 100 })))
  assert(#decoded == 2 and decoded[1] == 100 and decoded[2] == 300)
  assert(ns.Recipes.Decode('0') == nil and ns.Recipes.Decode('invalid!') == nil)
end)

check('bank capture reads item quantities and preserves an inaccessible tab', function()
  local queue, queries = {}, {}
  local old = { name = 'Officer supplies', items = { { id = 999, count = 7 } } }
  local ns = { report = {}, vault = { chars = {}, guilds = { ['Helping Hand - Forever'] = { tabs = { [2] = old } } } } }
  ns.After = function(delay, callback) queue[#queue + 1] = { delay = delay, callback = callback } end
  local env = environment({
    time = function() return 100 end,
    GetGuildInfo = function() return 'Helping Hand' end,
    GetRealmName = function() return 'Forever' end,
    GetNumGuildBankTabs = function() return 2 end,
    GetGuildBankMoney = function() return 321 end,
    QueryGuildBankTab = function(tab) queries[#queries + 1] = tab end,
    GetGuildBankTabInfo = function(tab) return tab == 1 and 'Supplies' or 'Officer supplies', 'icon', tab == 1 end,
    GetGuildBankItemInfo = function(tab, slot) if tab == 1 and slot == 1 then return 'icon', 3, false, false, 2 end end,
    GetGuildBankItemLink = function(tab, slot) if tab == 1 and slot == 1 then return '|Hitem:42|h[Supplies]|h' end end,
  })
  source('bank-tabs/Vault.lua', env, ns)
  local record = assert(ns.Vault.SnapshotGuildBank('source check'))
  table.sort(queue, function(a, b) return a.delay < b.delay end)
  for _, scheduled in ipairs(queue) do scheduled.callback() end
  assert(record.tabs[1].items[1].id == 42 and record.tabs[1].items[1].count == 3)
  assert(record.tabs[2] == old and record.tabs[2].items[1].count == 7)
  assert(record.money == 321 and #queries == 2)
end)

print(passed .. ' addon source behavior checks passed with controlled game API inputs.')
