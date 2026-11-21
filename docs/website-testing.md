# Website human tests

Mode: LQM. The website uses server-rendered routes and server-checked actions.

1. Open `/login` on the local website.
2. Select the local member test account when local test mode permits access.
3. Open each navigation route with a keyboard.
4. Search the roster and inspect account-link verification states.
5. Search the bank, filter bank characters, and select favorites.
6. Open an item's source details and inspect capture time, upload time, and completeness.
7. Request an item for a verified character.
8. Check the request status in the guild hall and bank.
9. Select a main character in My account.
10. Generate a member sync token under Addon Sync.
11. Copy the token into the addon settings.
12. Refresh My account and confirm that the page does not reveal the previous token.
13. Revoke the token.
14. Open Professions and offer a known craft.
15. Search for that craft with Offered crafts only selected.
16. Sign out and select the local owner test account.
17. Process an item request and confirm that confirmed bank stock stays unchanged.
18. Assign several profession titles to one character.
19. Assign the same profession title to several characters.
20. Generate a guild sync token.
21. Repeat the member workflows at a narrow mobile width.
22. Sign out and confirm that private records disappear from every route.

The login page shows Battle.net access only when the server configures that provider.
Local test accounts must remain unavailable in production.
Game-client tests require the Forever client and the companion addon.
