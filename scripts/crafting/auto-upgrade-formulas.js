/**
 * PF2e Auto-Upgrade Alchemical Formulas
 * 
 * According to Pathfinder 2e Remaster rules (Player Core 2, p. 48):
 * "When you learn a formula for an item that has higher-level types
 * (such as an elixir of life or acid flask), you automatically learn
 * the formulas for all higher-level types of that item when your level
 * is high enough to craft them."
 * 
 * This macro:
 * 1. Checks the selected character's level and known crafting formulas.
 * 2. Indexes the PF2e equipment compendium (and world items).
 * 3. Identifies all higher-level upgraded types of existing formulas
 *    whose item level is <= the character's current level.
 * 4. Displays an interactive confirmation dialog showing all discovered upgrades.
 * 5. Adds the selected upgraded formulas to the character sheet.
 * 6. Posts a detailed summary card to chat.
 */

export const AUTO_UPGRADE_FORMULAS_MACRO_NAME = "Auto-Upgrade Alchemical Formulas";
export const AUTO_UPGRADE_FORMULAS_MACRO_ICON = "icons/sundries/books/book-stack.webp";

// Recognized PF2e item tier keywords
const PAREN_TIER_REGEX = /\s*\((minor|lesser|moderate|greater|major|true|superior|standard|standard-grade|low-grade|high-grade|type\s+[0-9a-z]+)\)\s*$/i;
const PREFIX_TIER_REGEX = /^(minor|lesser|moderate|greater|major|true|superior|standard)\s+/i;
const SLUG_TIER_REGEX = /-(minor|lesser|moderate|greater|major|true|superior|standard|standard-grade|low-grade|high-grade|type-[0-9a-z]+)$/i;

function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

/**
 * Normalizes item names and slugs to identify base families and tiers.
 */
function parseItemIdentity(item) {
    const rawName = item.name || "";
    let baseName = rawName.trim();
    let tier = null;

    // Check parenthesized tier at end: "Bottled Lightning (Moderate)"
    const parenMatch = baseName.match(PAREN_TIER_REGEX);
    if (parenMatch) {
        tier = parenMatch[1].toLowerCase();
        baseName = baseName.replace(PAREN_TIER_REGEX, "").trim();
    } else {
        // Check prefix tier: "Moderate Healing Potion"
        const prefixMatch = baseName.match(PREFIX_TIER_REGEX);
        if (prefixMatch) {
            tier = prefixMatch[1].toLowerCase();
            baseName = baseName.replace(PREFIX_TIER_REGEX, "").trim();
        }
    }

    const rawSlug = item.system?.slug || "";
    let baseSlug = rawSlug.trim();
    if (baseSlug) {
        baseSlug = baseSlug.replace(SLUG_TIER_REGEX, "").trim();
    }

    const normalizedName = baseName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedSlug = baseSlug.toLowerCase().replace(/[^a-z0-9]/g, "");

    const traits = Array.isArray(item.system?.traits?.value)
        ? item.system.traits.value
        : (item.traits?.value || []);

    return {
        rawName,
        baseName,
        tier,
        normalizedName,
        normalizedSlug,
        level: Number(item.system?.level?.value ?? item.level ?? 0),
        type: item.type,
        traits
    };
}

/**
 * Server-side / GM function to update actor formulas, bypassing player permission restrictions if needed.
 */
export async function updateActorFormulasAsGM(actorUuid, formulas) {
    if (!actorUuid || !Array.isArray(formulas)) return false;
    const actor = await fromUuid(actorUuid);
    if (!actor) return false;
    try {
        await actor.update({ "system.crafting.formulas": formulas });
        return true;
    } catch (e) {
        console.error("PF2e Awesome Macros For Players | Failed to update actor formulas:", e);
        return false;
    }
}

/**
 * Main execution entry point for Auto-Upgrade Alchemical Formulas.
 */
export async function executeAutoUpgradeFormulas() {
    let actor = null;
    let token = null;
    const controlled = canvas?.tokens?.controlled ?? [];

    if (controlled.length === 1) {
        token = controlled[0];
        actor = token.actor;
    } else if (!game.user.isGM && game.user.character) {
        actor = game.user.character;
        token = actor.getActiveTokens()[0] ?? null;
    } else if (controlled.length > 1) {
        ui.notifications.warn("Please select only one token to check formulas.");
        return;
    } else {
        ui.notifications.warn("Please select a character token first.");
        return;
    }

    if (!actor || actor.type !== "character") {
        ui.notifications.warn("This macro only works on Player Character actors.");
        return;
    }

    const actorLevel = Number(actor.system?.details?.level?.value ?? actor.level ?? 1);

    // 1. Retrieve current known formulas
    const currentFormulas = Array.isArray(actor.system?.crafting?.formulas)
        ? actor.system.crafting.formulas
        : [];

    if (currentFormulas.length === 0) {
        ui.notifications.info(`${actor.name} does not have any formulas in their formula book yet.`);
        return;
    }

    const knownUuids = new Set();
    for (const f of currentFormulas) {
        const u = typeof f === "string" ? f : f?.uuid;
        if (u) knownUuids.add(u);
    }

    // 2. Index the standard equipment compendium pack
    const pack = game.packs.get("pf2e.equipment-srd");
    if (!pack) {
        ui.notifications.error("Could not find compendium pack 'pf2e.equipment-srd'.");
        return;
    }

    const index = await pack.getIndex({
        fields: [
            "system.level.value",
            "system.slug",
            "system.traits.value",
            "system.traits.rarity",
            "type",
            "img"
        ]
    });

    const indexByUuid = new Map();
    const indexById = new Map();

    for (const entry of index) {
        const entryUuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
        indexByUuid.set(entryUuid, entry);
        indexById.set(entry._id, entry);
    }

    // 3. Resolve and analyze all currently known formulas
    const knownItems = [];
    for (const uuid of knownUuids) {
        let itemData = indexByUuid.get(uuid);
        if (!itemData) {
            const idMatch = uuid.match(/\.Item\.([a-zA-Z0-9]+)$/);
            if (idMatch && indexById.has(idMatch[1])) {
                itemData = indexById.get(idMatch[1]);
            }
        }

        if (!itemData) {
            try {
                const doc = await fromUuid(uuid);
                if (doc) {
                    itemData = {
                        name: doc.name,
                        uuid: doc.uuid,
                        type: doc.type,
                        img: doc.img,
                        system: {
                            level: { value: doc.system?.level?.value ?? doc.level ?? 0 },
                            slug: doc.system?.slug ?? "",
                            traits: {
                                value: Array.isArray(doc.system?.traits?.value) ? doc.system.traits.value : []
                            }
                        }
                    };
                }
            } catch (e) {
                console.warn(`PF2e Auto-Upgrade Formulas | Could not load formula: ${uuid}`, e);
            }
        }

        if (itemData) {
            const parsed = parseItemIdentity(itemData);
            knownItems.push({
                uuid,
                name: itemData.name,
                img: itemData.img,
                type: itemData.type,
                level: parsed.level,
                identity: parsed
            });
        }
    }

    // 4. Gather candidate items from the compendium and world that meet the level criteria
    const candidateEntries = [];

    // Check compendium entries
    for (const entry of index) {
        const entryLevel = Number(entry.system?.level?.value ?? 0);
        if (entryLevel > actorLevel) continue;

        const entryUuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
        if (knownUuids.has(entryUuid)) continue;

        if (entry.type !== "consumable" && entry.type !== "equipment" && entry.type !== "weapon" && entry.type !== "armor") {
            continue;
        }

        const parsed = parseItemIdentity(entry);
        candidateEntries.push({
            entry,
            uuid: entryUuid,
            name: entry.name,
            img: entry.img,
            type: entry.type,
            level: entryLevel,
            identity: parsed
        });
    }

    // Check world items (for custom or homebrew alchemical items)
    for (const item of game.items) {
        const itemLevel = Number(item.system?.level?.value ?? 0);
        if (itemLevel > actorLevel) continue;
        if (knownUuids.has(item.uuid)) continue;
        if (item.type !== "consumable" && item.type !== "equipment" && item.type !== "weapon" && item.type !== "armor") {
            continue;
        }

        const parsed = parseItemIdentity(item);
        candidateEntries.push({
            entry: item,
            uuid: item.uuid,
            name: item.name,
            img: item.img,
            type: item.type,
            level: itemLevel,
            identity: parsed
        });
    }

    // 5. Match candidate items against known formulas
    const availableUpgradesMap = new Map();

    for (const known of knownItems) {
        for (const cand of candidateEntries) {
            // Must be strictly higher level than the known tier, but <= actorLevel
            if (cand.level <= known.level) continue;

            // Types must match (consumable vs consumable, equipment vs equipment)
            if (cand.type !== known.type) continue;

            const kId = known.identity;
            const cId = cand.identity;

            // Name or slug base must match
            const nameMatches = (kId.normalizedName && cId.normalizedName && kId.normalizedName === cId.normalizedName);
            const slugMatches = (kId.normalizedSlug && cId.normalizedSlug && kId.normalizedSlug === cId.normalizedSlug);

            if (!nameMatches && !slugMatches) continue;

            // Must be a tiered item
            if (!cId.tier && !kId.tier) continue;

            // If the known item is alchemical, the upgraded version must also be alchemical
            if (kId.traits.includes("alchemical") && !cId.traits.includes("alchemical")) continue;

            if (!availableUpgradesMap.has(cand.uuid)) {
                availableUpgradesMap.set(cand.uuid, {
                    uuid: cand.uuid,
                    name: cand.name,
                    img: cand.img || AUTO_UPGRADE_FORMULAS_MACRO_ICON,
                    level: cand.level,
                    type: cand.type,
                    basedOn: known.name,
                    baseLevel: known.level
                });
            }
        }
    }

    const availableUpgrades = Array.from(availableUpgradesMap.values()).sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        return a.name.localeCompare(b.name);
    });

    if (availableUpgrades.length === 0) {
        ui.notifications.info(`All formulas for ${actor.name} are already up to date for Level ${actorLevel}!`);
        return;
    }

    // 6. Build interactive confirmation dialog
    const itemsHtml = availableUpgrades.map(item => `
        <label style="display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; border-bottom: 1px solid rgba(0,0,0,0.06); cursor: pointer; transition: background 0.15s ease;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" name="formula-upgrade" value="${escapeHtml(item.uuid)}" checked style="margin: 0; cursor: pointer;" />
                <img src="${escapeHtml(item.img)}" width="28" height="28" style="border: 1px solid rgba(0,0,0,0.2); border-radius: 3px; object-fit: contain; background: rgba(0,0,0,0.05);" />
                <div>
                    <div style="font-weight: bold; font-size: 0.95em; color: #111;">${escapeHtml(item.name)}</div>
                    <div style="font-size: 0.8em; color: #666;">Upgrade from: ${escapeHtml(item.basedOn)} (Lvl ${item.baseLevel})</div>
                </div>
            </div>
            <span style="font-weight: bold; font-size: 0.85em; background: #e0e0e0; padding: 2px 6px; border-radius: 3px; white-space: nowrap; color: #222;">Lvl ${item.level}</span>
        </label>
    `).join('');

    const dialogContent = `
        <div style="font-family: 'Signika', sans-serif;">
            <p style="margin-bottom: 8px; line-height: 1.4;">
                Found <strong>${availableUpgrades.length}</strong> higher-level formula upgrade(s) available for <strong>${escapeHtml(actor.name)}</strong> (Level <strong>${actorLevel}</strong>):
            </p>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 6px; font-size: 0.85em;">
                <button type="button" id="select-all-formulas" style="width: auto; padding: 2px 8px; font-size: 0.85em; cursor: pointer; line-height: 1.4;">Select All</button>
                <button type="button" id="deselect-all-formulas" style="width: auto; padding: 2px 8px; font-size: 0.85em; cursor: pointer; line-height: 1.4;">Deselect All</button>
            </div>
            <div style="max-height: 320px; overflow-y: auto; border: 1px solid #ccc; border-radius: 4px; padding: 2px; background: rgba(0,0,0,0.02);">
                ${itemsHtml}
            </div>
            <p style="font-size: 0.8em; color: #666; margin-top: 8px; margin-bottom: 0;">
                <em>Per PF2e crafting rules.</em>
            </p>
        </div>
    `;

    new Dialog({
        title: `Auto-Upgrade Formulas — ${actor.name} (Lvl ${actorLevel})`,
        content: dialogContent,
        buttons: {
            apply: {
                icon: '<i class="fas fa-flask"></i>',
                label: `Add Formulas`,
                callback: async (html) => {
                    const selectedUuids = [];
                    html.find('input[name="formula-upgrade"]:checked').each(function () {
                        selectedUuids.push($(this).val());
                    });

                    if (selectedUuids.length === 0) {
                        ui.notifications.warn("No formulas were selected.");
                        return;
                    }

                    const selectedItems = availableUpgrades.filter(u => selectedUuids.includes(u.uuid));
                    const newEntries = selectedItems.map(item => ({ uuid: item.uuid }));
                    const finalFormulas = [...currentFormulas, ...newEntries];

                    let updateSuccess = false;
                    if (actor.isOwner) {
                        try {
                            await actor.update({ "system.crafting.formulas": finalFormulas });
                            updateSuccess = true;
                        } catch (e) {
                            console.warn("PF2e Auto-Upgrade Formulas | Direct actor update failed, attempting GM socket fallback...", e);
                        }
                    }

                    if (!updateSuccess && game.pf2eAwesomePlayerMacros?.updateActorFormulas) {
                        updateSuccess = await game.pf2eAwesomePlayerMacros.updateActorFormulas(actor.uuid, finalFormulas);
                    }

                    if (!updateSuccess && !actor.isOwner) {
                        ui.notifications.error("Could not update formula book: insufficient permissions.");
                        return;
                    }

                    if (actor.sheet?.rendered) {
                        actor.sheet.render(false);
                    }

                    ui.notifications.info(`Added ${selectedItems.length} upgraded formula(s) to ${actor.name}'s formula book!`);

                    // 7. Post summary chat card
                    const cardListHtml = selectedItems.map(item => `
                        <li style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; padding: 3px 6px; background: rgba(0,0,0,0.03); border-radius: 3px;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <img src="${escapeHtml(item.img)}" width="22" height="22" style="border: none; border-radius: 2px;" />
                                <span>@UUID[${item.uuid}]{${escapeHtml(item.name)}}</span>
                            </div>
                            <span style="font-weight: bold; font-size: 0.85em; background: rgba(0,0,0,0.08); padding: 1px 6px; border-radius: 3px;">Lvl ${item.level}</span>
                        </li>
                    `).join('');

                    const chatContent = `
                        <div class="pf2e chat-card">
                            <header class="card-header flexrow" style="align-items: center; gap: 8px;">
                                <img src="${AUTO_UPGRADE_FORMULAS_MACRO_ICON}" width="32" height="32" style="border: none; border-radius: 4px;" />
                                <div>
                                    <h3 style="margin: 0; line-height: 1.2;">Alchemical Formulas Upgraded</h3>
                                    <span style="font-size: 0.85em; color: #555;">${escapeHtml(actor.name)} (Level ${actorLevel})</span>
                                </div>
                            </header>
                            <div class="card-content" style="font-family: 'Signika', sans-serif; margin-top: 6px;">
                                <p style="margin-bottom: 6px;">Added <strong>${selectedItems.length}</strong> upgraded formula(s) to formula book:</p>
                                <ul style="list-style: none; padding-left: 0; margin: 0;">
                                    ${cardListHtml}
                                </ul>
                                <p style="font-size: 0.8em; color: #666; margin-top: 8px; border-top: 1px dashed #ccc; padding-top: 4px; margin-bottom: 0;">
                                    <em>Learned automatically per PF2e crafting rules.</em>
                                </p>
                            </div>
                        </div>
                    `;

                    await ChatMessage.create({
                        user: game.user.id,
                        speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
                        content: chatContent
                    });
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'apply',
        render: (html) => {
            html.find('#select-all-formulas').click(() => {
                html.find('input[name="formula-upgrade"]').prop('checked', true);
            });
            html.find('#deselect-all-formulas').click(() => {
                html.find('input[name="formula-upgrade"]').prop('checked', false);
            });
        }
    }, { width: 480 }).render(true);
}

