/**
 * Random Character Generator Macro for PF2e
 * 
 * Features:
 * - Rolls random Ancestry, Heritage, Class, Background, and Stats.
 * - Supports 3D dice rolling to chat.
 * - Auto-generates a dynamic name (e.g., "Random Goblin Rogue").
 * - Provides a GM-only button to instantly generate the actor.
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

        const uuids = e.currentTarget.dataset.uuids.split(",");
        const actorName = e.currentTarget.dataset.actorname || "Random Generated PC";
        const items = [];

        for (const uuid of uuids) {
            if (!uuid) continue;
            const item = await fromUuid(uuid);
            if (item) items.push(item.toObject());
        }

        const newActor = await Actor.create({
            name: actorName,
            type: "character",
            items: items
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
    const ancestry = await getRandomDoc("pf2e.ancestries", null, "Ancestry");
    if (ancestry) {
        results.uuids.push(ancestry.uuid);
        results.summary.ancestry = ancestry.name;
        await announce("Ancestry Revealed", ancestry.name);
    }

    // 2. Heritage (Optional)
    if (options.rHeritage) {
        const heritage = await getRandomDoc("pf2e.heritages", (i) => {
            const isMatch = i.system?.ancestry?.value === ancestry?.slug;
            const isVersatile = (i.system?.traits?.value || []).includes("versatile");
            return isMatch || isVersatile;
        }, "Heritage");
        if (heritage) {
            results.uuids.push(heritage.uuid);
            results.summary.heritage = heritage.name;
            await announce("Heritage Revealed", heritage.name);
        }
    }

    // 3. Class (Optional)
    if (options.rClass) {
        const class1 = await getRandomDoc("pf2e.classes", null, "Class");
        if (class1) {
            results.uuids.push(class1.uuid);
            results.summary.class = class1.name;
            await announce("Class Revealed", class1.name);
        }

        if (options.dual) {
            const class2 = await getRandomDoc("pf2e.classes", (i) => i._id !== class1?._id, "Dual Class");
            if (class2) {
                results.uuids.push(class2.uuid);
                results.summary.dualClass = class2.name;
                await announce("Dual Class Revealed", class2.name);
            }
        }
    }

    // 4. Background (Optional)
    if (options.bg) {
        const background = await getRandomDoc("pf2e.backgrounds", null, "Background");
        if (background) {
            results.uuids.push(background.uuid);
            results.summary.background = background.name;
            await announce("Background Revealed", background.name);
        }
    }

    // 5. Stats (Optional)
    if (options.rStats && !options.rClass) {
        const stats = [];
        await ChatMessage.create({
            content: `<strong>Rolling 4d6 (drop lowest) for 6 Stats...</strong>`,
            speaker: ChatMessage.getSpeaker()
        });

        for (let i = 0; i < 6; i++) {
            const r = await new Roll("4d6kh3").evaluate();
            await r.toMessage({ speaker: ChatMessage.getSpeaker() });
            stats.push(r.total);
            await new Promise(res => setTimeout(res, 800));
        }
        results.summary.stats = stats.join(", ");
        await announce("Stat Spread Result", results.summary.stats);
    }

    // Compile dynamic name
    let nameParts = ["Random"];
    if (results.summary.ancestry) nameParts.push(results.summary.ancestry);
    if (results.summary.class) nameParts.push(results.summary.class);
    results.actorName = nameParts.join(" ").trim();
    if (results.actorName === "Random") results.actorName = "Random Generated PC"; // Fallback

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
                    <label>Roll Random Stat Spread (4d6 drop lowest)</label>
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

async function getRandomDoc(packKey, filterFn, rollFlavor) {
    const pack = game.packs.get(packKey);
    if (!pack) return null;

    const indexCollection = await pack.getIndex({ fields: ["system"] });
    let index = indexCollection.contents;

    if (filterFn) index = index.filter(filterFn);
    if (index.length === 0) return null;

    // Create an actual dice roll using the length of the filtered compendium
    const roll = await new Roll(`1d${index.length}`).evaluate();

    // Send it to chat so 3D dice trigger
    await roll.toMessage({
        flavor: `Determining random <strong>${rollFlavor}</strong>...`,
        speaker: ChatMessage.getSpeaker()
    });

    // Dramatic pause for the dice to finish rolling visually
    await new Promise(r => setTimeout(r, 1500));

    // Determine the result (subtract 1 because arrays start at 0, dice start at 1)
    const chosenIndex = roll.total - 1;
    return await pack.getDocument(index[chosenIndex]._id);
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

    const gmMessageContent = `
        ${summaryHtml}
        <hr>
        <p>Click below to automatically create a character with these items applied.</p>
        <button class="create-random-pc-btn" data-uuids="${results.uuids.join(',')}" data-actorname="${results.actorName}">
            <i class="fas fa-user-plus"></i> Create ${results.actorName}
        </button>
    `;

    await ChatMessage.create({
        content: gmMessageContent,
        whisper: ChatMessage.getWhisperRecipients("GM")
    });
}