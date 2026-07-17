/**
 * Random Character Generator Macro for PF2e
 * 
 * Features:
 * - Rolls random Ancestry, Heritage, Class, Background, and Stats.
 * - Triggers standard 3D dice using a 1d100 percentage trick for compendiums.
 * - Custom Stat Allocation algorithm scaling from Level 1 to 20.
 * - Applies generated stats via manual override directly to the created Actor.
 * - Properly triggers PF2e ChoiceSet dialogs and sets level upon Actor creation.
 */

export const ROLL_RANDOM_CHARACTER_MACRO_NAME = "Roll for Random Character";
export const ROLL_RANDOM_CHARACTER_MACRO_ICON = "icons/sundries/gaming/dice-runed-brown.webp";

export function handleGMCreateButton(message, html, data) {
    if (!game.user.isGM) return;

    const btn = html.find(".create-random-pc-btn");
    if (!btn.length) return;

    btn.on("click", async (e) => {
        e.preventDefault();
        btn.prop("disabled", true);
        btn.text("Creating...");

        const dataset = e.currentTarget.dataset;
        const uuids = dataset.uuids.split(",");
        const actorName = dataset.actorname || "Random Generated PC";
        const actorLevel = parseInt(dataset.level) || 1;

        // Base system data, setting the character's level
        let systemData = {
            details: { level: { value: actorLevel } }
        };

        // Retrieve and parse our generated stats
        if (dataset.stats) {
            const stats = JSON.parse(dataset.stats);
            systemData.build = { attributes: { manual: true } };
            systemData.abilities = {};
            for (const [key, val] of Object.entries(stats)) {
                systemData.abilities[key] = { mod: val };
            }
        }

        const items = [];
        for (const uuid of uuids) {
            if (!uuid) continue;
            const item = await fromUuid(uuid);
            if (item) items.push(item.toObject());
        }

        // 1. Create the naked actor FIRST
        const newActor = await Actor.create({
            name: actorName,
            type: "character",
            system: systemData
        });

        // 2. Render the sheet so the GM can see the choice dialogs pop up
        newActor.sheet.render(true);

        // 3. Inject the items. This simulates dropping them onto the sheet 
        // and ensures PF2e fires all 'ChoiceSet' (Grant Item) dialogs.
        if (items.length > 0) {
            await newActor.createEmbeddedDocuments("Item", items);
        }

        ui.notifications.info(`Successfully created PC: ${newActor.name}`);
        btn.text("Actor Created");
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

    // Announce Level
    await announce("Target Level", `Level ${options.level}`);

    // 1. Ancestry (Optional)
    let ancestry = null;
    if (options.rAncestry) {
        ancestry = await getRandomDocWith3DDice("pf2e.ancestries", null, "Ancestry");
        if (ancestry) {
            results.uuids.push(ancestry.uuid);
            results.summary.ancestry = ancestry.name;
            await announce("Ancestry Revealed", ancestry.name);
        }
    }

    // 2. Heritage (Optional - Requires Ancestry to be rolled to filter properly)
    if (options.rHeritage && ancestry) {
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
        const class1 = await getRandomDocWith3DDice("pf2e.classes", null, "Class");
        if (class1) {
            results.uuids.push(class1.uuid);
            results.summary.class = class1.name;
            await announce("Class Revealed", class1.name);
        }

        if (options.dual) {
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
        const background = await getRandomDocWith3DDice("pf2e.backgrounds", null, "Background");
        if (background) {
            results.uuids.push(background.uuid);
            results.summary.background = background.name;
            await announce("Background Revealed", background.name);
        }
    }

    // 5. Stats (Optional)
    if (options.rStats) {
        // Determine brackets based on level
        let basePoints = 9;
        let statCap = 4;

        if (options.level >= 20) {
            basePoints = 25;
            statCap = 6;
        } else if (options.level >= 15) {
            basePoints = 21;
            statCap = 5;
        } else if (options.level >= 10) {
            basePoints = 17;
            statCap = 5;
        } else if (options.level >= 5) {
            basePoints = 13;
            statCap = 4;
        }

        let pointsLeft = options.dual ? basePoints + 1 : basePoints;
        const statsObj = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        const statKeys = Object.keys(statsObj);

        // Shuffle stat array
        for (let i = statKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [statKeys[i], statKeys[j]] = [statKeys[j], statKeys[i]];
        }

        await ChatMessage.create({
            content: `<strong>Allocating Stats...</strong><br>Total Points: ${pointsLeft} | Max Cap per Stat: ${statCap}`,
            speaker: ChatMessage.getSpeaker()
        });
        await new Promise(res => setTimeout(res, 1000));

        while (pointsLeft > 0) {
            for (const key of statKeys) {
                if (pointsLeft <= 0) break;
                if (statsObj[key] >= statCap) continue;

                const r = await new Roll("1d4").evaluate();
                const maxAdd = statCap - statsObj[key];
                const toAdd = Math.min(r.total, pointsLeft, maxAdd);

                if (toAdd > 0) {
                    await r.toMessage({
                        flavor: `Rolled ${r.total} -> Adding ${toAdd} to <strong>${key.toUpperCase()}</strong>`,
                        speaker: ChatMessage.getSpeaker()
                    });

                    statsObj[key] += toAdd;
                    pointsLeft -= toAdd;
                    await new Promise(res => setTimeout(res, 800));
                }
            }
        }

        results.summary.statsObj = statsObj;
        results.summary.stats = `STR: ${statsObj.str}, DEX: ${statsObj.dex}, CON: ${statsObj.con}, INT: ${statsObj.int}, WIS: ${statsObj.wis}, CHA: ${statsObj.cha}`;
        await announce("Final Stat Spread", results.summary.stats);
    }

    // Compile dynamic name
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
                    <input type="checkbox" id="rand-bg" checked />
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

                // Enforce Ancestry -> Heritage logic
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

    await new Promise(r => setTimeout(r, 1500));

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
    if (s.stats) summaryHtml += `<li><strong>Stats:</strong> ${s.stats}</li>`;
    summaryHtml += `</ul>`;

    await ChatMessage.create({
        content: summaryHtml,
        speaker: ChatMessage.getSpeaker()
    });

    const statsDataset = s.statsObj ? JSON.stringify(s.statsObj) : "";

    const gmMessageContent = `
        ${summaryHtml}
        <hr>
        <p>Click below to automatically create a character with these items applied.</p>
        <button class="create-random-pc-btn" data-level="${s.level}" data-uuids="${results.uuids.join(',')}" data-actorname="${results.actorName}" data-stats='${statsDataset}'>
            <i class="fas fa-user-plus"></i> Create Level ${s.level} ${results.actorName}
        </button>
    `;

    await ChatMessage.create({
        content: gmMessageContent,
        whisper: ChatMessage.getWhisperRecipients("GM")
    });
}