# Pf2e Awesome Macros For Players

Changes: \
11/10/2026 - Version 1.8.0 - Reorganized script files into categorized subfolders (`combat/`, `recall-knowledge/`, `crafting/`, and `general/`) matching macro categories. Updated all internal module and helper imports cleanly while keeping `constants.js` and `main.js` at root. \
\
11/10/2026 - Version 1.7.6 - Clean up text, formatting, and code messiness for various macros.
\
11/9/2026 - Version 1.7.2 - Added Twin Takedown macro for dual-wielding Rangers (Player Core, pg. 157) to execute two strikes against their hunted prey (one with each wielded melee weapon), progressing MAP normally with Flurry Hunter's Edge support, dynamic setup dialog with live modifier previews, secret target preservation, and combined damage calculation on hits for resistances and weaknesses. \
\
11/9/2026 - Version 1.7.1 - Concealed target creature names and image banners across all player combat and assessment macros (Twin Feint, Double Slice, Flurry of Blows, Magus's Analysis, Combat Assessment, Instructive Strike, Known Weaknesses, Monster Hunter, and Mastermind Rogue's Recall) in setup dialogs and public chat cards to prevent leaking unrevealed creature identities while preserving full targeting automation and damage integration. \
\
11/9/2026 - Version 1.7.0 - Added Auto-Upgrade Alchemical Formulas macro for Alchemists (Player Core 2, p. 48) to automatically identify and learn higher-level upgraded formulas (e.g., Bottled Lightning Lesser -> Moderate) up to the character's current level. Includes multi-formula selection dialog, compendium and world item indexing, permission-safe updating, and formatted chat summary cards. Reorganized macro folders with a dedicated 'Crafting' subfolder. \
\
11/9/2026 - Version 1.6.6 - Added 'Resistances' question option to Enhanced Recall Knowledge dialog, hints, public chat notifications, and automated player whisper replies. Also added Resistances display to the GM general overview card. \
\
11/7/2026 - Version 1.6.5 - Fixed some bugs. \
\
11/7/2026 - Version 1.6.2 - Expanded Lingering Composition to include full standard bard composition cantrips (Triple Time, Uplifting Overture, Inspire Competence, Allegro, Song of Marching, House of Imaginary Walls) and added dynamic sheet discovery to automatically detect, prioritize, and list any unique/custom composition cantrips known by the character. Updated Martial Performance to support extending all new cantrip effects. \
\
11/7/2026 - Version 1.6.1 - Updated Lingering Composition to query and apply official PF2e compendium spell effects (pf2e.spell-effects). Fixed Dirge of Doom so the bard is never debuffed by their own chant, and foes receive the native PF2e Frightened 1 condition to avoid redundant non-stacking debuffs. Preserved user's custom image for Martial Performance. \
\
11/7/2026 - Version 1.6.0 - Added Lingering Composition macro (with Performance check vs standard level DC, focus point deduction/refund, cantrip selection, aura generation, and direct allied application) and Martial Performance macro (Warrior Muse duration incrementation on active anthems by +1 round). \
\
11/7/2026 - Version 1.5.8 - Removed target creature name and banner from Hunted Shot chat cards and setup dialog to avoid exposing secret creature information. \
\
11/7/2026 - Version 1.5.7 - Fixed Twin Feint damage rolls so off-guard and Sneak Attack precision damage apply strictly to the second strike and not the first strike unless the creature was already off-guard. \
\
10/25/2026 - Version 1.5.6 - Added Reset Movement macro to instantly revert token movement in combat back to turn origin, clearing waypoint history and ruler trails with support for native revertRecordedMovement and action tracker resets. \
\
10/24/2026 - Version 1.5.5 - Updated Twin Feint to use Mastermind-style EphemeralEffect rule element (Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg) for Strike 2, providing native PF2e AC reduction and automatic Sneak Attack triggering. \
\
10/24/2026 - Version 1.5.4 - Fixed icon path for Twin Feint to verified core asset 'icons/skills/melee/weapons-crossed-daggers-orange.webp'. \
\
10/24/2026 - Version 1.5.3 - Added Twin Feint macro for Rogues to make two melee strikes with different weapons against the same target, automatically rendering the target Off-Guard against the second strike (enabling Sneak Attack) and applying normal MAP progression. \
\
10/24/2026 - Version 1.5.2 - Enhanced macro synchronization to guarantee existing macros are matched and updated in-place without altering their document IDs, ensuring player hotbars remain intact. \
\
10/24/2026 - Version 1.5.1 - Fixed subfolder nesting in Foundry VTT so 'Recall Knowledge' and 'Combat' are placed inside the main module folder. \
\
10/24/2026 - Version 1.5.0 - Added Double Slice macro for dual-wielding characters with agile auto-sorting to the secondary weapon, non-agile penalty calculation (-2), and combined damage. Reorganized macros into 'Recall Knowledge' and 'Combat' subfolders. \
\
10/24/2026 - Version 1.4.9 - Added Instructive Strike macro for Thaumaturges to Strike an enemy and immediately Recall Knowledge on a hit, granting a +2 circumstance bonus on a critical hit. \
\
10/24/2026 - Version 1.4.8 - Fixed macro icon path for Open Party Stash. \
\
10/24/2026 - Version 1.4.7 - Added Open Party Stash macro to easily open the active party sheet directly to the Stash (inventory) tab with a single click. \
\
10/17/2026 - Version 1.4.6 - Added Hunted Shot macro for Rangers to perform two ranged strikes against their hunted prey, progressing MAP normally and combining damage on hits. Reminds player if Hunt Prey is not active without blocking execution. \
\
10/17/2026 - Version 1.4.5 - Updated Flurry of Blows MAP options to display 'No MAP, MAP -5, MAP -10' with live character sheet bonuses and agile penalties. Added PF2e Toolbelt as optional recommended dependency. \
\
10/17/2026 - Version 1.4.4 - Added Flurry of Blows macro for Monks with MAP progression, outcome confirmation, and combined damage calculation. \
\
10/17/2026 - Version 1.4.3 - Updated Mastermind Rogues Recall macro for Mastermind Rogues with Mastermind's Assessment and Off-Guard. \
\
8/4/2026 - Version 1.4.2 - Tried to clean up the formatting for dubious knowledge a bit to make it easier to read. \
\
8/4/2026 - Version 1.4.0 - Added some options in the module settings to allow auto-reply to players or adjust some GM preferences. Still a bit Alpha. \
\
8/3/2026 - Version 1.3.9 - Added a slider to add a bonus modifier to the enhanced recall knowledge. Also check for dubious knowledge now. \
\
8/2/2026 - Version 1.3.8 - Added mastermind macro. Fixed some UI formatting and weirdness. \
\
7/25/ 2026 - Version 1.3.6 - Cleaned up some weirdness when players rolled recall knowledge checks with no target selected. \
\
7/25/2026 - Version 1.3.5 - Updated the enhanced recall knowledge macro to work better with special lores and added a few macros for specific classes to call the enhanced recall knowledge macro. \
\
7/20/2026 - Version 1.2.6: Migrated one macro from my GM module to player since it makes more sense. \
Fixed a syncing issue with macro changes. Also, moved the Monster Hunter macro to the player module from an in game macro. \
\
7/19/2026 - Version 1.2.2: Finally happy with Enhanced Recall Knowledge macro and Roll Random Character macro for Foundry VTT.
