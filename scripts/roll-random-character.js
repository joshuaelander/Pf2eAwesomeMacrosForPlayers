/**
 * Enhanced Recall Knowledge Macro for PF2e
 * 
 * Features:
 * - Rolls for selected tokens or the whole party.
 * - Properly calculates PF2e degrees of success (including Nat 1 / Nat 20 shifts).
 * - Analyzes targeted enemies to provide GMs with contextual hints (Truths & Lies)
 *   to handle Dubious Knowledge and Critical Failures easily.
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
        const items = [];

        for (const uuid of uuids) {
            if (!uuid) continue;
            const item = await fromUuid(uuid);
            if (item) items.push(item.toObject());
        }

        const newActor = await Actor.create({
            name: "Random Generated PC",
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
            content: `<strong>${title}:</strong> ${content}`,
            speaker: ChatMessage.getSpeaker()
        });
        await new Promise(r => setTimeout(r, 1000));
    };

    const ancestry = await getRandomDoc("pf2e.ancestries");
    if (ancestry) {
        results.uuids.push(ancestry.uuid);
        results.summary.ancestry = ancestry.name;
        await announce("Ancestry", ancestry.name);
    }

    const heritage = await getRandomDoc("pf2e.heritages", (i) => {
        const isMatch = i.system?.ancestry?.value === ancestry?.slug;
        const isVersatile = (i.system?.traits?.value || []).includes("versatile");
        return isMatch || isVersatile;
    });
    if (heritage) {
        results.uuids.push(heritage.uuid);
        results.summary.heritage = heritage.name;
        await announce("Heritage", heritage.name);
    }

    if (options.rClass) {
        const class1 = await getRandomDoc("pf2e.classes");
        if (class1) {
            results.uuids.push(class1.uuid);
            results.summary.class = class1.name;
            await announce("Class", class1.name);
        }

        if (options.dual) {
            const class2 = await getRandomDoc("pf2e.classes", (i) => i._id !== class1?._id);
            if (class2) {
                results.uuids.push(class2.uuid);
                results.summary.dualClass = class2.name;
                await announce("Dual Class", class2.name);
            }
        }
    }

    if (options.bg) {
        const background = await getRandomDoc("pf2e.backgrounds");
        if (background) {
            results.uuids.push(background.uuid);
            results.summary.background = background.name;
            await announce("Background", background.name);
        }
    }

    if (options.rStats && !options.rClass) {
        const stats = [];
        for (let i = 0; i < 6; i++) {
            const r = await new Roll("4d6kh3").evaluate();
            stats.push(r.total);
        }
        results.summary.stats = stats.join(", ");
        await announce("Stat Spread", results.summary.stats);
    }

    await postSummary(results);
}

async function promptOptions() {
    return new Promise((resolve) => {
        const dialogContent = `
            <form>
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
            <script>
                const classBox = document.getElementById('rand-class');
                const statBox = document.getElementById('rand-stats');
                classBox.addEventListener('change', (e) => {
                    statBox.disabled = e.target.checked;
                    if (e.target.checked) statBox.checked = false;
                });
            </script>
        `;

        new Dialog({
            title: "Random PC Generator",
            content: dialogContent,
            buttons: {
                roll: {
                    icon: '<i class="fas fa-dice"></i>',
                    label: "Roll!",
                    callback: (html) => {
                        resolve({
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

async function getRandomDoc(packKey, filterFn) {
    const pack = game.packs.get(packKey);
    if (!pack) return null;

    // getIndex returns a Collection. We use .contents to turn it into a standard Array.
    const indexCollection = await pack.getIndex({ fields: ["system"] });
    let index = indexCollection.contents;

    // Now we can safely use array methods like .filter() and .length
    if (filterFn) index = index.filter(filterFn);

    if (index.length === 0) return null;

    // Grab a random entry from the array
    const randomEntry = index[Math.floor(Math.random() * index.length)];

    return await pack.getDocument(randomEntry._id);
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
        <button class="create-random-pc-btn" data-uuids="${results.uuids.join(',')}">
            <i class="fas fa-user-plus"></i> Create Actor
        </button>
    `;

    await ChatMessage.create({
        content: gmMessageContent,
        whisper: ChatMessage.getWhisperRecipients("GM")
    });
}