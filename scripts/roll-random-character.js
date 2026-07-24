/**
 * Random Character Generator Macro for PF2e
 * 
 * Features:
 * - Rolls random Ancestry, Heritage, Class, Background, and Stats.
 * - Triggers standard 3D dice using a 1d100 percentage trick for compendiums.
 * - Custom Stat Allocation algorithm scaling from Level 1 to 20.
 * - Accurately calculates PF2e 18+ stat costs.
 * - Uses Socketlib to securely allow players to create their own sheet.
 * - Allows multiple character creations, but prevents spam-clicking a single roll.
 * - Routes Class/Ancestry selection dialogs properly to the player's screen.
 */

export const ROLL_RANDOM_CHARACTER_MACRO_NAME = "Roll for Random Character";
export const ROLL_RANDOM_CHARACTER_MACRO_ICON = "icons/sundries/gaming/dice-runed-brown.webp";

export function handlePlayerCreateButton(message, html, data) {
    const btn = html.find(".create-random-pc-btn");
    if (!btn.length) return;

    btn.on("click", async (e) => {
        e.preventDefault();

        // Prevent double clicking
        if (btn.prop("disabled")) return;
        btn.prop("disabled", true);
        btn.text("Requesting Sheet...");

        const dataset = e.currentTarget.dataset;

        // Package the data for Socketlib
        const actorData = {
            rollId: dataset.rollid,
            name: dataset.actorname || "Random Generated PC",
            level: parseInt(dataset.level) || 1,
            stats: dataset.stats ? JSON.parse(dataset.stats) : null
        };

        // Fire request to the GM Client to build the empty shell
        const result = await game.pf2eAwesomePlayerMacros.createRandomActor(actorData);

        if (!result || !result.success) {
            if (result?.error === "limit_reached") {
                ui.notifications.warn("This specific roll has already been created.");
                btn.text("Completed");
            } else {
                ui.notifications.error("Failed to create character. Is a GM currently logged in?");
                btn.prop("disabled", false);
                btn.text("Try Again");
            }
            return;
        }

        ui.notifications.info(`Successfully created PC shell. Applying classes and choices...`);
        btn.text("Completed");

        // Wait 1 second to ensure the network has fully synced the player's new OWNER 
        // permissions for this actor before attempting to add items to it.
        setTimeout(async () => {
            const newActor = game.actors.get(result.actorId);
            if (newActor) {

                // Fetch the items strictly on the player's client
                const uuids = dataset.uuids ? dataset.uuids.split(",") : [];
                const itemsToCreate = [];
                for (const uuid of uuids) {
                    if (!uuid) continue;
                    const item = await fromUuid(uuid);
                    if (item) itemsToCreate.push(item.toObject());
                }

                // Add the items. Because the player's client is executing this line,
                // the PF2e system will correctly route all ChoiceSet dialogs to the player!
                if (itemsToCreate.length > 0) {
                    await newActor.createEmbeddedDocuments("Item", itemsToCreate);
                }

                newActor.sheet.render(true);
            }
        }, 1000);
    });
}

// --- CORE LOGIC & HELPERS --- //
export async function createCharacter() {
    const options = await promptOptions();
    if (!options) return;

    const results = { uuids: [], summary: { level: options.level } };

    const announce = async (title, content) => {
        await ChatMessage.create({
            content: `<strong>${title}:</strong> <span style="font-size: 1.1em; color: var(--color-text-dark-primary);">${content}</span>`,
            speaker: ChatMessage.getSpeaker()
        });
        await new Promise(r => setTimeout(r, 1000));
    };

    let isFirstRoll = true;
    const checkPrompt = async (message) => {
        if (isFirstRoll) {
            isFirstRoll = false;
            return true;
        }
        return new Promise((resolve) => {
            new Dialog({
                title: "Next Roll...",
                content: `<div style="text-align: center; padding: 15px;"><h3>${message}</h3></div>`,
                buttons: {
                    ok: {
                        icon: '<i class="fas fa-arrow-right"></i>',
                        label: "Okay",
                        callback: () => resolve(true)
                    }
                },
                default: "ok",
                close: () => resolve(false)
            }, { width: 300 }).render(true);
        });
    };

    await announce("Target Level", `Level ${options.level}`);

    // 1. Ancestry (Optional)
    let ancestry = null;
    if (options.rAncestry) {
        if (!await checkPrompt("Next: Rolling for Ancestry")) return;
        ancestry = await getRandomDocWith3DDice("pf2e.ancestries", null, "Ancestry");
        if (ancestry) {
            results.uuids.push(ancestry.uuid);
            results.summary.ancestry = ancestry.name;
            await announce("Ancestry Revealed", ancestry.name);
        }
    }

    // 2. Heritage (Optional)
    if (options.rHeritage && ancestry) {
        if (!await checkPrompt("Next: Rolling for Heritage")) return;
        const ancestrySlug = ancestry.system?.slug || ancestry.slug || ancestry.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
        const ancestryUuid = ancestry.uuid;

        const heritage = await getRandomDocWith3DDice("pf2e.heritages", (h) => {
            const hAncestryVal = h.system?.ancestry?.value || h.system?.ancestry?.slug;
            const hAncestryUuid = h.system?.ancestry?.uuid;

            const isMatch = (hAncestryVal === ancestrySlug) || (hAncestryUuid === ancestryUuid);
            const isVersatile = (h.system?.traits?.value || []).includes("versatile");

            return isMatch || isVersatile;
        }, "Heritage", true);

        if (heritage) {
            results.uuids.push(heritage.uuid);
            results.summary.heritage = heritage.name;
            await announce("Heritage Revealed", heritage.name);
        }
    }

    // 3. Class (Optional)
    if (options.rClass) {
        if (!await checkPrompt("Next: Rolling for Class")) return;
        const class1 = await getRandomDocWith3DDice("pf2e.classes", null, "Class");
        if (class1) {
            results.uuids.push(class1.uuid);
            results.summary.class = class1.name;
            await announce("Class Revealed", class1.name);
        }

        if (options.dual) {
            if (!await checkPrompt("Next: Rolling for Dual Class")) return;
            const class2 = await getRandomDocWith3DDice("pf2e.classes", (i) => i._id !== class1?._id, "Dual Class");
            if (class2) {
                results.uuids.push(class2.uuid);
                results.summary.dualClass = class2.name;
                await announce("Dual Class Revealed", class2.name);
            }
        }
    }

    // 4. Background (Optional)
    if (options.bg) {
        if (!await checkPrompt("Next: Rolling for Background")) return;
        const background = await getRandomDocWith3DDice("pf2e.backgrounds", null, "Background");
        if (background) {
            results.uuids.push(background.uuid);
            results.summary.background = background.name;
            await announce("Background Revealed", background.name);
        }
    }

    // 5. Stats (Optional)
    if (options.rStats) {
        if (!await checkPrompt("Next: Allocating Random Stats")) return;

        let basePoints = 9;
        let statCap = 4;

        if (options.level >= 20) {
            basePoints = 25;
            statCap = 8; // 8 points = +6 Mod
        } else if (options.level >= 15) {
            basePoints = 21;
            statCap = 7; // 7 points = +5 Mod (halfway to +6)
        } else if (options.level >= 10) {
            basePoints = 17;
            statCap = 6; // 6 points = +5 Mod
        } else if (options.level >= 5) {
            basePoints = 13;
            statCap = 5; // 5 points = +4 Mod (halfway to +5)
        }

        let pointsLeft = options.dual ? basePoints + 1 : basePoints;
        const statsPoints = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        const statKeys = Object.keys(statsPoints);

        for (let i = statKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [statKeys[i], statKeys[j]] = [statKeys[j], statKeys[i]];
        }

        await ChatMessage.create({
            content: `<strong>Allocating Stats...</strong><br>Total Points: ${pointsLeft} | Max Points per Stat: ${statCap}`,
            speaker: ChatMessage.getSpeaker()
        });
        await new Promise(res => setTimeout(res, 1000));

        while (pointsLeft > 0) {
            for (const key of statKeys) {
                if (pointsLeft <= 0) break;
                if (statsPoints[key] >= statCap) continue;

                const r = await new Roll("1d4").evaluate();
                const maxAdd = statCap - statsPoints[key];
                const toAdd = Math.min(r.total, pointsLeft, maxAdd);

                if (toAdd > 0) {
                    await r.toMessage({
                        flavor: `Rolled ${r.total} -> Adding ${toAdd} pts to <strong>${key.toUpperCase()}</strong>`,
                        speaker: ChatMessage.getSpeaker()
                    });

                    statsPoints[key] += toAdd;
                    pointsLeft -= toAdd;
                    await new Promise(res => setTimeout(res, 800));
                }
            }
        }

        const statsMods = {};
        for (const key of statKeys) {
            const pts = statsPoints[key];
            statsMods[key] = pts <= 4 ? pts : 4 + Math.floor((pts - 4) / 2);
        }

        results.summary.statsObj = statsMods;

        const formatStat = (key) => `${statsMods[key]} <span style="font-size: 0.8em; color: gray;">(${statsPoints[key]}pts)</span>`;
        results.summary.stats = `<br>STR: ${formatStat('str')}<br>DEX: ${formatStat('dex')}<br>CON: ${formatStat('con')}<br>INT: ${formatStat('int')}<br>WIS: ${formatStat('wis')}<br>CHA: ${formatStat('cha')}`;

        await announce("Final Stat Spread", results.summary.stats);
    }

    let nameParts = ["Random"];
    if (results.summary.ancestry) nameParts.push(results.summary.ancestry);
    if (results.summary.class) nameParts.push(results.summary.class);
    results.actorName = nameParts.join(" ").trim();
    if (results.actorName === "Random") results.actorName = "Random Generated PC";

    await postSummary(results);
}

async function promptOptions() {
    return new Promise((resolve) => {
        const dialogContent = `
            <form>
                <div class="form-group">
                    <label>Character Level</label>
                    <input type="number" id="char-level" value="1" min="1" max="20" />
                </div>
                <hr>
                <div class="form-group">
                    <label>Roll Ancestry</label>
                    <input type="checkbox" id="rand-ancestry" checked />
                </div>
                <div class="form-group">
                    <label>Roll Heritage</label>
                    <input type="checkbox" id="rand-heritage" checked />
                    <p class="notes">Requires Ancestry to be rolled.</p>
                </div>
                <div class="form-group">
                    <label>Roll Random Class</label>
                    <input type="checkbox" id="rand-class" checked />
                </div>
                <div class="form-group">
                    <label>Roll Dual Class</label>
                    <input type="checkbox" id="rand-dual" />
                </div>
                <div class="form-group">
                    <label>Roll Background</label>
                    <input type="checkbox" id="rand-bg" />
                </div>
                <div class="form-group">
                    <label>Roll Random Stat Spread</label>
                    <input type="checkbox" id="rand-stats" />
                    <p class="notes">Manually overrides the created Actor's stats.</p>
                </div>
            </form>
        `;

        new Dialog({
            title: "Random PC Generator",
            content: dialogContent,
            render: (html) => {
                const ancestryBox = html.find('#rand-ancestry');
                const heritageBox = html.find('#rand-heritage');

                ancestryBox.on('change', (e) => {
                    const isChecked = e.target.checked;
                    heritageBox.prop('disabled', !isChecked);
                    if (!isChecked) heritageBox.prop('checked', false);
                });
            },
            buttons: {
                roll: {
                    icon: '<i class="fas fa-dice"></i>',
                    label: "Roll!",
                    callback: (html) => {
                        resolve({
                            level: parseInt(html.find('#char-level').val()) || 1,
                            rAncestry: html.find('#rand-ancestry').is(':checked'),
                            rHeritage: html.find('#rand-heritage').is(':checked'),
                            rClass: html.find('#rand-class').is(':checked'),
                            dual: html.find('#rand-dual').is(':checked'),
                            bg: html.find('#rand-bg').is(':checked'),
                            rStats: html.find('#rand-stats').is(':checked')
                        });
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel",
                    callback: () => resolve(null)
                }
            },
            default: "roll"
        }).render(true);
    });
}

async function getRandomDocWith3DDice(packKey, filterFn, rollFlavor, loadFullDocs = false) {
    const pack = game.packs.get(packKey);
    if (!pack) return null;

    let itemsArray = [];
    if (loadFullDocs) {
        itemsArray = await pack.getDocuments();
    } else {
        const indexCollection = await pack.getIndex({ fields: ["system"] });
        itemsArray = indexCollection.contents;
    }

    if (filterFn) itemsArray = itemsArray.filter(filterFn);
    if (itemsArray.length === 0) return null;

    const roll = await new Roll(`1d100`).evaluate();
    await roll.toMessage({
        flavor: `Rolling 1d100 to determine random <strong>${rollFlavor}</strong>...`,
        speaker: ChatMessage.getSpeaker()
    });

    await new Promise(r => setTimeout(r, 4000));

    const percentage = (roll.total - 1) / 100;
    const chosenIndex = Math.floor(percentage * itemsArray.length);

    if (loadFullDocs) {
        return itemsArray[chosenIndex];
    } else {
        return await pack.getDocument(itemsArray[chosenIndex]._id);
    }
}

async function postSummary(results) {
    const s = results.summary;
    let summaryHtml = `<h3>Random Generation Complete</h3><ul>`;
    summaryHtml += `<li><strong>Level:</strong> ${s.level}</li>`;
    if (s.ancestry) summaryHtml += `<li><strong>Ancestry:</strong> ${s.ancestry}</li>`;
    if (s.heritage) summaryHtml += `<li><strong>Heritage:</strong> ${s.heritage}</li>`;
    if (s.class) summaryHtml += `<li><strong>Class:</strong> ${s.class}</li>`;
    if (s.dualClass) summaryHtml += `<li><strong>Dual Class:</strong> ${s.dualClass}</li>`;
    if (s.background) summaryHtml += `<li><strong>Background:</strong> ${s.background}</li>`;
    if (s.stats) summaryHtml += `<li><strong>Stats:</strong>${s.stats}</li>`;
    summaryHtml += `</ul>`;

    await ChatMessage.create({
        content: summaryHtml,
        speaker: ChatMessage.getSpeaker()
    });

    // Generate a unique ID for this specific roll
    const rollId = foundry.utils.randomID();
    const statsDataset = s.statsObj ? JSON.stringify(s.statsObj) : "";

    const userMessageContent = `
        ${summaryHtml}
        <hr>
        <p>Click below to automatically create a character with these settings applied.</p>
        <button class="create-random-pc-btn" data-rollid="${rollId}" data-level="${s.level}" data-uuids="${results.uuids.join(',')}" data-actorname="${results.actorName}" data-stats='${statsDataset}'>
            <i class="fas fa-user-plus"></i> Create Level ${s.level} ${results.actorName}
        </button>
    `;

    const gmIds = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
    const whisperRecipients = [...new Set([...gmIds, game.user.id])];

    await ChatMessage.create({
        content: userMessageContent,
        whisper: whisperRecipients
    });
}