/**
 * PF2e Easy Exploration Activity Manager
 * * Logic:
 * 1. Scans compendium for standard exploration activities.
 * 2. Scans actor for existing exploration activities.
 * 3. On selection:
 * - If the item exists on the actor, activates it.
 * - If the item is only in the compendium, copies it to the actor FIRST, then activates the new item.
 * 4. Updates actor.system.exploration with the LOCAL Item ID (required for the sheet to work).
 */

export const EXPLORATION_ACTIVITY_MACRO_NAME = "Easy Exploration";
export const EXPLORATION_ACTIVITY_MACRO_ICON = "icons/tools/navigation/map-marked-blue.webp";

export async function addExplorationActivity() {
    const tokens = canvas.tokens.controlled;

    if (tokens.length === 0) {
        ui.notifications.warn("Please select a token first.");
    } else if (tokens.length > 1) {
        ui.notifications.warn("Please select only one token.");
    } else {
        const token = tokens[0];
        const actor = token.actor;

        if (!actor || actor.type !== "character") {
            ui.notifications.warn("This macro only works on Player Character actors.");
        } else {
            manageExploration(token, actor);
        }
    }

    async function manageExploration(token, actor) {
        const pack = game.packs.get("pf2e.actionspf2e");
        if (!pack) {
            ui.notifications.error("Could not find compendium 'pf2e.actionspf2e'.");
            return;
        }

        // 1. Get Compendium Index
        const index = await pack.getIndex({ fields: ["name", "img", "system.traits"] });

        // 2. Prepare Options
        // We store the Compendium UUID for everything initially. 
        // We will resolve it to a Local ID in the setExploration function.
        let standardOptions = [];
        let characterOptions = [];

        // Filter Compendium for 'exploration' trait
        for (const entry of index) {
            const traits = entry.system?.traits?.value || [];
            if (traits.includes("exploration")) {
                // Standard Compendium UUID
                const compendiumUuid = `Compendium.${pack.collection}.Item.${entry._id}`;
                standardOptions.push({
                    name: entry.name,
                    uuid: compendiumUuid,
                    img: entry.img
                });
            }
        }
        standardOptions.sort((a, b) => a.name.localeCompare(b.name));

        // Filter Actor Items for 'exploration' trait
        // These are items the actor DEFINITELY has.
        const explorationItems = [
            ...actor.itemTypes.action,
            ...actor.itemTypes.feat
        ].filter(i => i.system.traits.value.includes("exploration"));

        for (const item of explorationItems) {
            characterOptions.push({
                name: item.name,
                // For these, we specifically want the UUID to point to the Actor's item, 
                // but for simplicity in the dialog, we can pass the item's ID or UUID.
                // We'll pass the UUID for consistency.
                uuid: item.uuid,
                img: item.img
            });
        }
        characterOptions.sort((a, b) => a.name.localeCompare(b.name));

        // 3. Build Dialog
        let content = `
    <style>
        .exp-macro-row { display: flex; align-items: center; margin-bottom: 5px; }
        .exp-macro-select { flex: 1; }
    </style>
    <div class="form-group">
        <label>Select Activity:</label>
        <div class="exp-macro-row">
            <select id="exploration-select" style="width: 100%">
                <option value="CLEAR">-- Stop Exploration Activity --</option>
                
                <optgroup label="Character Abilities (On Sheet)">
                    ${characterOptions.map(opt => `<option value="${opt.uuid}">${opt.name}</option>`).join("")}
                </optgroup>

                <optgroup label="Standard Activities (Compendium)">
                    ${standardOptions.map(opt => `<option value="${opt.uuid}">${opt.name}</option>`).join("")}
                </optgroup>
            </select>
        </div>
        <p class="notes" style="font-size: 0.9em; color: #666; margin-top: 5px;">
            If you select a Standard Activity not on your sheet, it will be added automatically.
        </p>
    </div>
    `;

        new Dialog({
            title: `Exploration: ${token.name}`,
            content: content,
            buttons: {
                ok: {
                    label: "Set Activity",
                    icon: `<i class="fas fa-walking"></i>`,
                    callback: async (html) => {
                        const selectedUuid = html.find("#exploration-select").val();
                        const selectedName = html.find("#exploration-select option:selected").text();

                        if (selectedUuid === "CLEAR") {
                            await clearExploration(actor, token);
                        } else {
                            await setExploration(actor, token, selectedUuid, selectedName);
                        }
                    }
                },
                cancel: { label: "Cancel" }
            },
            default: "ok"
        }).render(true);
    }

    async function setExploration(actor, token, uuid, name) {
        try {
            let finalItemId = "";

            // CHECK: Is this UUID pointing to a Compendium Item?
            if (uuid.startsWith("Compendium")) {
                // We need to find if the actor ALREADY has this item to avoid duplicates.
                // We check matching Source ID (best) or Name (fallback)
                let existingItem = actor.items.find(i =>
                    i.sourceId === uuid || i.name === name
                );

                if (existingItem) {
                    finalItemId = existingItem.id;
                } else {
                    // Fetch from Compendium
                    const sourceItem = await fromUuid(uuid);
                    if (!sourceItem) throw new Error("Could not find item in compendium.");

                    // Create on Actor
                    const createdItems = await actor.createEmbeddedDocuments("Item", [sourceItem.toObject()]);
                    finalItemId = createdItems[0].id;
                }
            } else {
                // It's already an Actor UUID (Actor.xyz.Item.abc)
                // We just need the actual Item ID (the last part of the UUID)
                finalItemId = uuid.split(".").pop();
            }

            // CRITICAL STEP: Update the system.exploration array with the LOCAL Item ID
            await actor.update({
                "system.exploration": [finalItemId]
            });

            // Chat Message
            ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ token: token }),
                content: `
                <div style="display: flex; align-items: center;">
                    <div style="margin-right: 10px;">
                        <img src="${token.document.texture.src}" style="width: 40px; height: 40px; border: none; object-fit: cover;" />
                    </div>
                    <div>
                        <strong>${token.name}</strong>'s exploration activity:<br/>
                        <span style="font-weight: bold; font-size: 1.1em; color: var(--color-text-hyperlink);">
                            ${name}
                        </span>
                    </div>
                </div>
            `,
                flags: { pf2e: { context: { type: "exploration-selection" } } }
            });

            ui.notifications.info(`Set ${token.name}'s exploration activity to ${name}`);

        } catch (err) {
            console.error(`Error setting exploration:`, err);
            ui.notifications.error(`Could not set exploration. Check console.`);
        }
    }

    async function clearExploration(actor, token) {
        await actor.update({
            "system.exploration": []
        });

        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ token: token }),
            content: `<strong>${token.name}</strong> has stopped exploration activities.`
        });
    }
}