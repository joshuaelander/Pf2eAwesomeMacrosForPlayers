/**
 * Random Character Generator Macro for PF2e
 * 
 * Features:
 * - Rolls random Ancestry, Heritage, Class, Background, and Stats.
 * - Triggers standard 3D dice using a 1d100 percentage trick for compendiums.
 * - Custom Stat Allocation algorithm (Rolls d4s to distribute 9-10 points, max 4 per stat).
 * - Applies generated stats via manual override directly to the created Actor.
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

        // Retrieve and parse our generated stats
        let systemData = {};
        if (dataset.stats) {
            const stats = JSON.parse(dataset.stats);
            systemData = {
                build: { attributes: { manual: true } }, // PF2e flag to allow manual stat entry
                abilities: {}
            };
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

        const newActor = await Actor.create({
            name: actorName,
            type: "character",
            items: items,
            system: systemData
        });

        ui.notifications.info(`Successfully created PC: ${newActor.name}`);
        btn.text("Actor Created");
    });
}

// --- CORE LOGIC & HELPERS --- //
export async function createCharacter() {
    const options = await promptOptions();
    if (!options) return;

    const results = { uuids: [], summary: {} };

    const announce = async (title, content) => {
        await ChatMessage.create({
            content: `<strong>${title}:</strong> <span style="font-size: 1.1em; color: var(--color-text-dark-primary);">${content}</span>`,
            speaker: ChatMessage.getSpeaker()
        });
        await new Promise(r => setTimeout(r, 1000));
    };

    // 1. Ancestry
    const ancestry = await getRandomDocWith3DDice("pf2e.ancestries", null, "Ancestry");
    if (ancestry) {
        results.uuids.push(ancestry.uuid);
        results.summary.ancestry = ancestry.name;
        await announce("Ancestry Revealed", ancestry.name);
    }

    // 2. Heritage (Optional)
    if (options.rHeritage && ancestry) {
        // Fallbacks to reliably grab the ancestry identifier across different PF2e versions
        const ancestrySlug = ancestry.system?.slug || ancestry.slug || ancestry.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
        const ancestryUuid = ancestry.uuid;

        // Fetch full documents for Heritages because the index misses nested system data
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
    // Runs when checkbox is ticked. Checkbox is automatically enabled if Random Class is unchecked.
    if (options.rStats) {
        let pointsLeft = options.dual ? 10 : 9;
        const statsObj = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        const statKeys = Object.keys(statsObj);

        // Shuffle stat array randomly so stats on the left don't get priority over stats on the right
        for (let i = statKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [statKeys[i], statKeys[j]] = [statKeys[j], statKeys[i]];
        }

        await ChatMessage.create({
            content: `<strong>Allocating Stats...</strong> (Total Points to Distribute: ${pointsLeft})`,
            speaker: ChatMessage.getSpeaker()
        });
        await new Promise(res => setTimeout(res, 1000));

        // Loop and roll 1d4s until we hit 0 points
        while (pointsLeft > 0) {
            for (const key of statKeys) {
                if (pointsLeft <= 0) break;
                if (statsObj[key] >= 4) continue; // Hard cap of 4 per stat at level 1

                const r = await new Roll("1d4").evaluate();
                const maxAdd = 4 - statsObj[key]; // Don't overfill past 4
                const toAdd = Math.min(r.total, pointsLeft, maxAdd);

                if (toAdd > 0) {
                    await r.toMessage({
                        flavor: `Rolled ${r.total} -> Adding ${toAdd} to <strong>${key.toUpperCase()}</strong>`,
                        speaker: ChatMessage.getSpeaker()
                    });

                    statsObj[key] += toAdd;
                    pointsLeft -= toAdd;
                    await new Promise(res => setTimeout(res, 800)); // Pause so dice can roll visually
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
                    <label>Roll Heritage</label>
                    <input type="checkbox" id="rand-heritage" checked />
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
                    <input type="checkbox" id="rand-stats" disabled />
                    <p class="notes">Disabled while Random Class is selected.</p>
                </div>
            </form>
        `;

        new Dialog({
            title: "Random PC Generator",
            content: dialogContent,
            render: (html) => {
                const classBox = html.find('#rand-class');
                const statBox = html.find('#rand-stats');

                // Enforce the logic: Stat rolling only unlocked if Class rolling is OFF
                classBox.on('change', (e) => {
                    const isChecked = e.target.checked;
                    statBox.prop('disabled', isChecked);
                    if (isChecked) statBox.prop('checked', false);
                });
            },
            buttons: {
                roll: {
                    icon: '<i class="fas fa-dice"></i>',
                    label: "Roll!",
                    callback: (html) => {
                        resolve({
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

/**
 * Custom fetcher that rolls a standard 1d100 to trigger 3D dice, 
 * using the percentage result to pick from any array length.
 */
async function getRandomDocWith3DDice(packKey, filterFn, rollFlavor, loadFullDocs = false) {
    const pack = game.packs.get(packKey);
    if (!pack) return null;

    let itemsArray = [];
    if (loadFullDocs) {
        itemsArray = await pack.getDocuments(); // Heavy, but necessary for nested data like Heritages
    } else {
        const indexCollection = await pack.getIndex({ fields: ["system"] });
        itemsArray = indexCollection.contents; // Lighter, great for Classes/Ancestries
    }

    if (filterFn) itemsArray = itemsArray.filter(filterFn);
    if (itemsArray.length === 0) return null;

    // Roll a standard d100 to trigger visual 3D dice module
    const roll = await new Roll(`1d100`).evaluate();
    await roll.toMessage({
        flavor: `Rolling 1d100 to determine random <strong>${rollFlavor}</strong>...`,
        speaker: ChatMessage.getSpeaker()
    });

    // Dramatic pause for the dice to finish rolling visually
    await new Promise(r => setTimeout(r, 1500));

    // Convert the d100 (1-100) into a percentage (0.00 - 0.99) to select array index
    const percentage = (roll.total - 1) / 100;
    const chosenIndex = Math.floor(percentage * itemsArray.length);

    // If we loaded full docs, return it immediately. Otherwise, get the full document by ID.
    if (loadFullDocs) {
        return itemsArray[chosenIndex];
    } else {
        return await pack.getDocument(itemsArray[chosenIndex]._id);
    }
}

async function postSummary(results) {
    const s = results.summary;
    let summaryHtml = `<h3>Random Generation Complete</h3><ul>`;
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

    // Encode the stats object into a dataset string so the listener can grab it
    const statsDataset = s.statsObj ? JSON.stringify(s.statsObj) : "";

    const gmMessageContent = `
        ${summaryHtml}
        <hr>
        <p>Click below to automatically create a character with these items applied.</p>
        <button class="create-random-pc-btn" data-uuids="${results.uuids.join(',')}" data-actorname="${results.actorName}" data-stats='${statsDataset}'>
            <i class="fas fa-user-plus"></i> Create ${results.actorName}
        </button>
    `;

    await ChatMessage.create({
        content: gmMessageContent,
        whisper: ChatMessage.getWhisperRecipients("GM")
    });
}