/**
 * PF2e Buy Crafting Formulas Macro
 * 
 * Rules (Pathfinder Player Core, p. 287 / Table 6-13: Formulas):
 * - Characters can purchase formulas for common craftable items in settlements.
 * - Formulas for higher-level items cost a fixed amount based on the item's level:
 *     Level 0: 5 sp (50 cp)
 *     Level 1: 1 gp (100 cp)
 *     Level 2: 2 gp (200 cp)
 *     Level 3: 3 gp (300 cp)
 *     Level 4: 5 gp (500 cp)
 *     Level 5: 8 gp (800 cp)
 *     Level 6: 13 gp (1,300 cp)
 *     Level 7: 18 gp (1,800 cp)
 *     Level 8: 25 gp (2,500 cp)
 *     Level 9: 35 gp (3,500 cp)
 *     Level 10: 50 gp (5,000 cp)
 *     Level 11: 70 gp (7,000 cp)
 *     Level 12: 100 gp (10,000 cp)
 *     Level 13: 150 gp (15,000 cp)
 *     Level 14: 225 gp (22,500 cp)
 *     Level 15: 325 gp (32,500 cp)
 *     Level 16: 500 gp (50,000 cp)
 *     Level 17: 750 gp (75,000 cp)
 *     Level 18: 1,200 gp (120,000 cp)
 *     Level 19: 2,000 gp (200,000 cp)
 *     Level 20: 3,500 gp (350,000 cp)
 * 
 * Features:
 * - Scans PF2e equipment compendium and world items for craftable formulas.
 * - Filters items up to character level (with optional level selection).
 * - Identifies existing formulas already known on the character sheet.
 * - Organized into tabs: Alchemical Formulas and Magical Formulas (detecting Alchemical and Magical Crafting feats).
 * - Categorizes items (Bombs, Elixirs, Poisons, Potions, Talismans, Scrolls, Gear, etc.).
 * - Live purse and cart summary showing total cost and remaining coins.
 * - Deducts currency from character sheet via native inventory / socketlib.
 * - Adds purchased formulas directly to actor's formula book (system.crafting.formulas).
 * - Posts a detailed purchase receipt card to chat.
 */

export const BUY_FORMULAS_MACRO_NAME = "Buy Crafting Formulas";
export const BUY_FORMULAS_MACRO_ICON = "icons/sundries/books/book-embossed-jewel-blue-red.webp";

/**
 * Standard PF2e Formula Prices by Item Level (Table 6-13: Formulas).
 */
export const FORMULA_PRICES_BY_LEVEL = {
    0: { cp: 50, label: "5 sp" },
    1: { cp: 100, label: "1 gp" },
    2: { cp: 200, label: "2 gp" },
    3: { cp: 300, label: "3 gp" },
    4: { cp: 500, label: "5 gp" },
    5: { cp: 800, label: "8 gp" },
    6: { cp: 1300, label: "13 gp" },
    7: { cp: 1800, label: "18 gp" },
    8: { cp: 2500, label: "25 gp" },
    9: { cp: 3500, label: "35 gp" },
    10: { cp: 5000, label: "50 gp" },
    11: { cp: 7000, label: "70 gp" },
    12: { cp: 10000, label: "100 gp" },
    13: { cp: 15000, label: "150 gp" },
    14: { cp: 22500, label: "225 gp" },
    15: { cp: 32500, label: "325 gp" },
    16: { cp: 50000, label: "500 gp" },
    17: { cp: 75000, label: "750 gp" },
    18: { cp: 120000, label: "1,200 gp" },
    19: { cp: 200000, label: "2,000 gp" },
    20: { cp: 350000, label: "3,500 gp" }
};

/**
 * Returns formula price in copper pieces and readable label for an item level.
 */
export function getFormulaPrice(level) {
    const lvl = Math.max(0, Math.min(20, Math.floor(level || 0)));
    return FORMULA_PRICES_BY_LEVEL[lvl] || { cp: 50, label: "5 sp" };
}

/**
 * Converts copper pieces to formatted PF2e coin string (e.g. '12 gp 5 sp').
 */
export function formatCopper(cp) {
    if (cp === 0) return "0 gp";
    const isNegative = cp < 0;
    const absCp = Math.abs(cp);
    const parts = [];
    const pp = Math.floor(absCp / 1000);
    const gp = Math.floor((absCp % 1000) / 100);
    const sp = Math.floor((absCp % 100) / 10);
    const remCp = absCp % 10;

    if (pp > 0) parts.push(`${pp} pp`);
    if (gp > 0) parts.push(`${gp} gp`);
    if (sp > 0) parts.push(`${sp} sp`);
    if (remCp > 0) parts.push(`${remCp} cp`);

    const formatted = parts.length > 0 ? parts.join(" ") : "0 gp";
    return isNegative ? `-${formatted}` : formatted;
}

/**
 * Retrieves the total copper value from an actor's currency inventory.
 */
export function getActorCopperValue(actor) {
    if (!actor) return 0;
    const coins = actor.inventory?.coins;
    if (typeof coins?.copperValue === "number") return coins.copperValue;
    if (coins) {
        const cp = Number(coins.cp || 0);
        const sp = Number(coins.sp || 0);
        const gp = Number(coins.gp || 0);
        const pp = Number(coins.pp || 0);
        return cp + sp * 10 + gp * 100 + pp * 1000;
    }
    const treasureCoins = actor.itemTypes?.treasure?.filter(t => t.isCoinage) || [];
    let totalCp = 0;
    for (const t of treasureCoins) {
        const denom = t.system?.denomination?.value;
        const qty = Number(t.system?.quantity ?? 1);
        if (denom === "pp") totalCp += qty * 1000;
        else if (denom === "gp") totalCp += qty * 100;
        else if (denom === "sp") totalCp += qty * 10;
        else if (denom === "cp") totalCp += qty;
    }
    return totalCp;
}

/**
 * Deducts copper value from an actor's purse with automatic denomination handling.
 */
export async function deductActorCoins(actor, totalCopperCost) {
    if (totalCopperCost <= 0) return true;
    if (typeof actor.inventory?.removeCoins === "function") {
        try {
            await actor.inventory.removeCoins({ cp: totalCopperCost }, { byValue: true });
            return true;
        } catch (err) {
            console.warn("PF2e Buy Formulas | actor.inventory.removeCoins error, attempting direct adjustment:", err);
        }
    }

    // Direct manual fallback if removeCoins fails
    const currentTotalCp = getActorCopperValue(actor);
    if (currentTotalCp < totalCopperCost) return false;
    const newTotalCp = currentTotalCp - totalCopperCost;

    const newPp = Math.floor(newTotalCp / 1000);
    const newGp = Math.floor((newTotalCp % 1000) / 100);
    const newSp = Math.floor((newTotalCp % 100) / 10);
    const newCp = newTotalCp % 10;

    const coinage = actor.itemTypes?.treasure?.filter(t => t.isCoinage) || [];
    const updates = [];
    const toDelete = [];

    const coinMap = { pp: newPp, gp: newGp, sp: newSp, cp: newCp };

    for (const item of coinage) {
        const denom = item.system?.denomination?.value;
        if (denom && coinMap[denom] !== undefined) {
            updates.push({ _id: item.id, "system.quantity": coinMap[denom] });
            delete coinMap[denom];
        } else {
            toDelete.push(item.id);
        }
    }

    if (toDelete.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", toDelete);
    }
    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates);
    }

    return true;
}

/**
 * Categorizes an item based on its type and traits.
 */
function categorizeItem(item) {
    const traits = Array.isArray(item.system?.traits?.value) ? item.system.traits.value : (item.traits?.value || []);
    const nameLower = (item.name || "").toLowerCase();
    const type = item.type || "";
    const category = item.system?.category || "";

    const isAlchemical = traits.includes("alchemical") || category === "alchemical";
    const isMagical = traits.includes("magical") || traits.includes("potion") || traits.includes("oil") ||
                      traits.includes("talisman") || traits.includes("scroll") || traits.includes("wand") ||
                      traits.includes("staff") || traits.includes("apex") ||
                      traits.includes("arcane") || traits.includes("divine") || traits.includes("occult") || traits.includes("primal");

    let subcategory = "Other";

    if (isAlchemical) {
        if (traits.includes("bomb") || category === "bomb") subcategory = "Bombs";
        else if (traits.includes("elixir") || nameLower.includes("elixir")) subcategory = "Elixirs";
        else if (traits.includes("poison") || category === "poison") subcategory = "Poisons";
        else if (traits.includes("ammunition") || traits.includes("ammo") || nameLower.includes("ammunition")) subcategory = "Ammunition";
        else if (traits.includes("food") || traits.includes("drug") || traits.includes("drink")) subcategory = "Food & Drink";
        else subcategory = "Alchemical Tools & Gear";
    } else if (isMagical) {
        if (traits.includes("potion") || traits.includes("oil") || nameLower.includes("potion") || nameLower.includes("oil")) subcategory = "Potions & Oils";
        else if (traits.includes("talisman")) subcategory = "Talismans";
        else if (traits.includes("scroll") || traits.includes("wand") || traits.includes("staff")) subcategory = "Scrolls, Wands & Staves";
        else if (type === "weapon" || type === "armor" || type === "shield") subcategory = "Weapons, Armor & Shields";
        else if (type === "equipment" || type === "backpack") subcategory = "Worn & Held Items";
        else subcategory = "Magical Consumables & Gear";
    }

    return { isAlchemical, isMagical, subcategory };
}

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
 * Socketlib handler to deduct coins and update formulas as GM.
 */
export async function buyActorFormulasAsGM(actorUuid, formulaUuids, totalCopper) {
    if (!actorUuid || !Array.isArray(formulaUuids)) return { success: false, reason: "invalid_params" };
    const doc = await fromUuid(actorUuid);
    const actor = doc?.actor ?? doc;
    if (!actor) return { success: false, reason: "actor_not_found" };

    if (totalCopper > 0) {
        const deducted = await deductActorCoins(actor, totalCopper);
        if (!deducted) return { success: false, reason: "deduction_failed" };
    }

    const currentFormulas = Array.isArray(actor.system?.crafting?.formulas)
        ? [...actor.system.crafting.formulas]
        : [];
    const knownUuids = new Set(currentFormulas.map(f => typeof f === "string" ? f : f?.uuid).filter(Boolean));

    for (const uuid of formulaUuids) {
        if (!knownUuids.has(uuid)) {
            currentFormulas.push({ uuid });
            knownUuids.add(uuid);
        }
    }

    try {
        await actor.update({ "system.crafting.formulas": currentFormulas });
        return { success: true };
    } catch (err) {
        console.error("PF2e Buy Formulas | Socket update formulas error:", err);
        return { success: false, reason: "update_failed" };
    }
}

/**
 * Main macro execution entry point for Buy Crafting Formulas.
 */
export async function executeBuyFormulas() {
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
        ui.notifications.warn("Please select only one token to browse formulas.");
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
    const walletCp = getActorCopperValue(actor);

    // 1. Feat & Crafting Proficiency checks
    const hasAlchemicalCrafting = actor.itemTypes.feat.some(f => 
        f.slug === "alchemical-crafting" || 
        f.name?.toLowerCase().includes("alchemical crafting")
    ) || actor.class?.slug === "alchemist" || actor.itemTypes.heritage?.some(h => h.slug?.includes("alchemist"));

    const hasMagicalCrafting = actor.itemTypes.feat.some(f => 
        f.slug === "magical-crafting" || 
        f.name?.toLowerCase().includes("magical crafting")
    );

    // 2. Identify currently known formulas
    const currentFormulas = Array.isArray(actor.system?.crafting?.formulas)
        ? actor.system.crafting.formulas
        : [];
    const knownUuids = new Set();
    const knownSlugs = new Set();

    for (const f of currentFormulas) {
        const u = typeof f === "string" ? f : f?.uuid;
        if (u) {
            knownUuids.add(u);
            const match = u.match(/\.Item\.([a-zA-Z0-9]+)$/);
            if (match) knownUuids.add(match[1]);
        }
    }

    // 3. Query PF2e Equipment compendium
    const pack = game.packs.get("pf2e.equipment-srd");
    if (!pack) {
        ui.notifications.error("Could not find compendium pack 'pf2e.equipment-srd'.");
        return;
    }

    ui.notifications.info("Loading formula catalog, please wait a moment...");

    const index = await pack.getIndex({
        fields: [
            "system.level.value",
            "system.slug",
            "system.traits.value",
            "system.traits.rarity",
            "system.category",
            "type",
            "img"
        ]
    });

    // 4. Gather and organize candidate formulas
    const candidateItems = [];
    const validTypes = new Set(["consumable", "equipment", "weapon", "armor", "shield", "backpack"]);

    // Helper to evaluate item entry
    const processEntry = (entry, isWorld = false) => {
        const type = entry.type;
        if (!validTypes.has(type)) return;

        const level = Number(entry.system?.level?.value ?? entry.level ?? 0);
        if (level > actorLevel) return;

        const traits = Array.isArray(entry.system?.traits?.value) ? entry.system.traits.value : (entry.traits?.value || []);
        const categoryInfo = categorizeItem(entry);
        if (!categoryInfo.isAlchemical && !categoryInfo.isMagical) return;

        const uuid = isWorld ? entry.uuid : (entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`);
        const slug = entry.system?.slug || entry.slug || "";
        const rarity = entry.system?.traits?.rarity || "common";
        const priceInfo = getFormulaPrice(level);

        const isKnown = knownUuids.has(uuid) || (entry._id && knownUuids.has(entry._id)) || (slug && knownSlugs.has(slug));

        candidateItems.push({
            uuid,
            name: entry.name,
            img: entry.img || "icons/sundries/books/book-embossed-jewel-blue-red.webp",
            level,
            rarity,
            type,
            slug,
            priceCp: priceInfo.cp,
            priceLabel: priceInfo.label,
            isAlchemical: categoryInfo.isAlchemical,
            isMagical: categoryInfo.isMagical,
            subcategory: categoryInfo.subcategory,
            isKnown
        });
    };

    for (const entry of index) {
        processEntry(entry, false);
    }
    for (const item of game.items) {
        processEntry(item, true);
    }

    // Sort items by level ascending, then name ascending
    candidateItems.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        return a.name.localeCompare(b.name);
    });

    const alchemicalCount = candidateItems.filter(i => i.isAlchemical).length;
    const magicalCount = candidateItems.filter(i => i.isMagical).length;

    if (candidateItems.length === 0) {
        ui.notifications.warn(`No craftable formulas found at or below level ${actorLevel}.`);
        return;
    }

    // Default active tab: alchemical if known or alchemist; otherwise magical
    let activeTab = hasAlchemicalCrafting || !hasMagicalCrafting ? "alchemical" : "magical";
    const selectedItems = new Map(); // uuid -> itemData

    // 5. Build Dialog UI
    const alchFeatBadge = hasAlchemicalCrafting
        ? `<span style="background: #2e7d32; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;">Alchemical Crafting</span>`
        : `<span style="background: #757575; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;" title="Lacks feat (can still purchase formulas)">No Alchemical Feat</span>`;

    const magFeatBadge = hasMagicalCrafting
        ? `<span style="background: #1976d2; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;">Magical Crafting</span>`
        : `<span style="background: #757575; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;" title="Requires Magical Crafting feat to craft">No Magical Feat</span>`;

    const dialogContent = `
        <div style="font-family: 'Signika', sans-serif; display: flex; flex-direction: column; gap: 8px;">
            <!-- Header Summary Box -->
            <div style="background: #f7f7f7; border: 1px solid #ddd; border-radius: 5px; padding: 8px 12px; display: grid; grid-template-columns: 1fr 1fr 1fr 1.2fr; gap: 8px; align-items: center;">
                <div>
                    <div style="font-size: 0.75em; color: #666; text-transform: uppercase; font-weight: bold;">Character Purse</div>
                    <div id="bf-wallet-display" style="font-size: 1.1em; font-weight: bold; color: #c99818;">${formatCopper(walletCp)}</div>
                </div>
                <div>
                    <div style="font-size: 0.75em; color: #666; text-transform: uppercase; font-weight: bold;">Selected</div>
                    <div id="bf-count-display" style="font-size: 1.1em; font-weight: bold; color: #333;">0 formulas</div>
                </div>
                <div>
                    <div style="font-size: 0.75em; color: #666; text-transform: uppercase; font-weight: bold;">Total Cost</div>
                    <div id="bf-total-cost-display" style="font-size: 1.1em; font-weight: bold; color: #2e7d32;">0 gp</div>
                </div>
                <div>
                    <div style="font-size: 0.75em; color: #666; text-transform: uppercase; font-weight: bold;">Remaining Wallet</div>
                    <div id="bf-remaining-display" style="font-size: 1.1em; font-weight: bold; color: #1b5e20;">${formatCopper(walletCp)}</div>
                </div>
            </div>

            <!-- Actor & Feats Bar -->
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; font-size: 0.85em; color: #555;">
                <div>
                    <strong>${escapeHtml(actor.name)}</strong> (Level ${actorLevel})
                </div>
                <div style="display: flex; gap: 4px;">
                    ${alchFeatBadge}
                    ${magFeatBadge}
                </div>
            </div>

            <!-- Tab Navigation -->
            <div style="display: flex; border-bottom: 2px solid #ccc; gap: 4px; margin-top: 2px;">
                <button type="button" class="bf-tab-btn" data-tab="alchemical" style="flex: 1; padding: 6px 10px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: ${activeTab === 'alchemical' ? '#fff' : '#e0e0e0'}; font-weight: bold;">
                    🧪 Alchemical Formulas (${alchemicalCount})
                </button>
                <button type="button" class="bf-tab-btn" data-tab="magical" style="flex: 1; padding: 6px 10px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: ${activeTab === 'magical' ? '#fff' : '#e0e0e0'}; font-weight: bold;">
                    ✨ Magical Formulas (${magicalCount})
                </button>
            </div>

            <!-- Filter Controls Toolbar -->
            <div style="background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.85em;">
                <div style="flex: 2; min-width: 140px;">
                    <input type="text" id="bf-search-input" placeholder="Search formulas..." style="width: 100%; height: 26px; padding: 2px 6px; border: 1px solid #ccc; border-radius: 3px;" />
                </div>
                <div style="flex: 1.2; min-width: 120px;">
                    <select id="bf-category-select" style="width: 100%; height: 26px; border: 1px solid #ccc; border-radius: 3px;">
                        <option value="all">All Subcategories</option>
                    </select>
                </div>
                <div style="flex: 1; min-width: 100px;">
                    <select id="bf-level-select" style="width: 100%; height: 26px; border: 1px solid #ccc; border-radius: 3px;">
                        <option value="all">All Levels (0 - ${actorLevel})</option>
                        ${Array.from({ length: actorLevel + 1 }, (_, i) => `<option value="${i}">Level ${i} (${getFormulaPrice(i).label})</option>`).join('')}
                    </select>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                        <input type="checkbox" id="bf-common-only" checked />
                        <span>Common Only</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                        <input type="checkbox" id="bf-hide-known" checked />
                        <span>Hide Known</span>
                    </label>
                </div>
                <div style="margin-left: auto; display: flex; gap: 4px;">
                    <button type="button" id="bf-select-visible" style="font-size: 0.75em; padding: 2px 6px; cursor: pointer;">Select Visible</button>
                    <button type="button" id="bf-clear-selection" style="font-size: 0.75em; padding: 2px 6px; cursor: pointer;">Clear Selection</button>
                </div>
            </div>

            <!-- Scrollable Formula List Container -->
            <div id="bf-list-container" style="max-height: 340px; overflow-y: auto; border: 1px solid #ccc; border-radius: 4px; background: #fff; padding: 4px;">
                <!-- Filled dynamically by JavaScript -->
            </div>

            <!-- Price Guide & Rule Reference -->
            <div style="font-size: 0.75em; color: #666; border-top: 1px dashed #ddd; padding-top: 4px; display: flex; justify-content: space-between; align-items: center;">
                <span>Formula prices determined by Item Level (Table 6-13: Formulas).</span>
                <span id="bf-visible-count" style="font-weight: bold; color: #444;"></span>
            </div>
        </div>
    `;

    const dialog = new Dialog({
        title: "Buy Crafting Formulas",
        content: dialogContent,
        buttons: {
            cancel: {
                label: "Cancel"
            },
            buy: {
                label: "Buy Selected (0 gp)",
                callback: async () => {
                    if (selectedItems.size === 0) {
                        ui.notifications.warn("No formulas selected for purchase.");
                        return;
                    }

                    const selectedList = Array.from(selectedItems.values());
                    const totalCostCp = selectedList.reduce((sum, item) => sum + item.priceCp, 0);

                    // Verify funds
                    const currentPurse = getActorCopperValue(actor);
                    if (currentPurse < totalCostCp) {
                        ui.notifications.error(`Insufficient funds! ${actor.name} needs ${formatCopper(totalCostCp)}, but only has ${formatCopper(currentPurse)}.`);
                        return;
                    }

                    const formulaUuids = selectedList.map(i => i.uuid);

                    // Deduct coins & add formulas
                    let success = false;

                    if (actor.isOwner) {
                        try {
                            const coinSuccess = await deductActorCoins(actor, totalCostCp);
                            if (coinSuccess) {
                                const currentFormulas = Array.isArray(actor.system?.crafting?.formulas)
                                    ? [...actor.system.crafting.formulas]
                                    : [];
                                const existingUuids = new Set(currentFormulas.map(f => typeof f === "string" ? f : f?.uuid).filter(Boolean));

                                for (const uuid of formulaUuids) {
                                    if (!existingUuids.has(uuid)) {
                                        currentFormulas.push({ uuid });
                                        existingUuids.add(uuid);
                                    }
                                }

                                await actor.update({ "system.crafting.formulas": currentFormulas });
                                success = true;
                            }
                        } catch (err) {
                            console.warn("PF2e Buy Formulas | Direct purchase failed, attempting socketlib:", err);
                        }
                    }

                    // Socketlib fallback
                    if (!success && game.pf2eAwesomePlayerMacros?.buyActorFormulas) {
                        const socketRes = await game.pf2eAwesomePlayerMacros.buyActorFormulas(actor.uuid, formulaUuids, totalCostCp);
                        if (socketRes?.success) success = true;
                    }

                    if (!success) {
                        ui.notifications.error("Failed to complete purchase. Check actor permissions and coin balance.");
                        return;
                    }

                    // Refresh actor sheet if open
                    if (actor.sheet?.rendered) {
                        actor.sheet.render(false);
                    }

                    const newPurse = getActorCopperValue(actor);
                    ui.notifications.info(`Successfully purchased ${selectedList.length} formula(s) for ${formatCopper(totalCostCp)}!`);

                    // 6. Post purchase receipt to chat
                    const itemsHtml = selectedList.map(item => `
                        <li style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; padding: 2px 6px; background: rgba(0,0,0,0.03); border-radius: 3px; font-size: 0.9em;">
                            <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                <img src="${escapeHtml(item.img)}" width="20" height="20" style="border: none; border-radius: 2px; flex-shrink: 0;" />
                                <span>@UUID[${item.uuid}]{${escapeHtml(item.name)}}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                <span style="font-size: 0.8em; background: rgba(0,0,0,0.08); padding: 1px 4px; border-radius: 2px;">Lvl ${item.level}</span>
                                <span style="font-weight: bold; font-size: 0.85em; color: #2e7d32;">${escapeHtml(item.priceLabel)}</span>
                            </div>
                        </li>
                    `).join('');

                    const chatContent = `
                        <div class="pf2e chat-card">
                            <header class="card-header flexrow" style="align-items: center; gap: 8px;">
                                <img src="${BUY_FORMULAS_MACRO_ICON}" width="32" height="32" style="border: none; border-radius: 4px;" />
                                <div>
                                    <h3 style="margin: 0; line-height: 1.2;">Crafting Formulas Purchased</h3>
                                    <span style="font-size: 0.85em; color: #555;">${escapeHtml(actor.name)} (Level ${actorLevel})</span>
                                </div>
                            </header>
                            <div class="card-content" style="font-family: 'Signika', sans-serif; margin-top: 6px;">
                                <div style="display: flex; justify-content: space-between; padding: 4px 8px; background: rgba(0,0,0,0.04); border-radius: 4px; margin-bottom: 8px; font-size: 0.85em;">
                                    <div><strong>Formulas:</strong> ${selectedList.length}</div>
                                    <div><strong>Spent:</strong> <span style="color: #c99818; font-weight: bold;">${formatCopper(totalCostCp)}</span></div>
                                    <div><strong>Remaining:</strong> ${formatCopper(newPurse)}</div>
                                </div>
                                <ul style="list-style: none; padding-left: 0; margin: 0; max-height: 220px; overflow-y: auto;">
                                    ${itemsHtml}
                                </ul>
                                <p style="font-size: 0.75em; color: #666; margin-top: 8px; border-top: 1px dashed #ccc; padding-top: 4px; margin-bottom: 0;">
                                    <em>Formulas added to formula book at official Table 6-13 market rates.</em>
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
            }
        },
        default: "buy",
        render: (html) => {
            const updateCategoryDropdown = () => {
                const subcategories = new Set();
                for (const item of candidateItems) {
                    if (activeTab === "alchemical" && item.isAlchemical) subcategories.add(item.subcategory);
                    if (activeTab === "magical" && item.isMagical) subcategories.add(item.subcategory);
                }

                const catSelect = html.find("#bf-category-select");
                const currentVal = catSelect.val();
                let optionsHtml = `<option value="all">All Subcategories</option>`;
                for (const cat of Array.from(subcategories).sort()) {
                    optionsHtml += `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
                }
                catSelect.html(optionsHtml);
                if (subcategories.has(currentVal)) {
                    catSelect.val(currentVal);
                }
            };

            const updateCartSummary = () => {
                const selectedList = Array.from(selectedItems.values());
                const totalCostCp = selectedList.reduce((sum, item) => sum + item.priceCp, 0);
                const remainingCp = walletCp - totalCostCp;

                html.find("#bf-count-display").text(`${selectedList.length} formula${selectedList.length === 1 ? '' : 's'}`);
                html.find("#bf-total-cost-display").text(formatCopper(totalCostCp));

                const remainingEl = html.find("#bf-remaining-display");
                remainingEl.text(formatCopper(remainingCp));

                if (remainingCp < 0) {
                    remainingEl.css("color", "#c62828");
                    html.find("#bf-total-cost-display").css("color", "#c62828");
                } else {
                    remainingEl.css("color", "#1b5e20");
                    html.find("#bf-total-cost-display").css("color", "#2e7d32");
                }

                // Update the Buy dialog button label
                const buyBtn = html.closest(".dialog").find('button[data-button="buy"]');
                if (buyBtn.length) {
                    buyBtn.html(`<i class="fas fa-coins" style="margin-right: 4px;"></i> Buy Selected (${selectedList.length}) - ${formatCopper(totalCostCp)}`);
                    if (remainingCp < 0 || selectedList.length === 0) {
                        buyBtn.prop("disabled", selectedList.length === 0);
                    } else {
                        buyBtn.prop("disabled", false);
                    }
                }
            };

            const renderFormulaList = () => {
                const searchTxt = (html.find("#bf-search-input").val() || "").trim().toLowerCase();
                const catVal = html.find("#bf-category-select").val() || "all";
                const lvlVal = html.find("#bf-level-select").val() || "all";
                const commonOnly = html.find("#bf-common-only").is(":checked");
                const hideKnown = html.find("#bf-hide-known").is(":checked");

                const filtered = candidateItems.filter(item => {
                    if (activeTab === "alchemical" && !item.isAlchemical) return false;
                    if (activeTab === "magical" && !item.isMagical) return false;
                    if (searchTxt && !item.name.toLowerCase().includes(searchTxt)) return false;
                    if (catVal !== "all" && item.subcategory !== catVal) return false;
                    if (lvlVal !== "all" && item.level !== parseInt(lvlVal, 10)) return false;
                    if (commonOnly && item.rarity !== "common") return false;
                    if (hideKnown && item.isKnown) return false;
                    return true;
                });

                html.find("#bf-visible-count").text(`Showing ${filtered.length} of ${candidateItems.filter(i => activeTab === "alchemical" ? i.isAlchemical : i.isMagical).length} formulas`);

                if (filtered.length === 0) {
                    html.find("#bf-list-container").html(`
                        <div style="text-align: center; color: #777; padding: 24px; font-style: italic;">
                            No matching formulas found for this filter.
                        </div>
                    `);
                    return;
                }

                // Group filtered items by Level
                const byLevel = new Map();
                for (const item of filtered) {
                    if (!byLevel.has(item.level)) byLevel.set(item.level, []);
                    byLevel.get(item.level).push(item);
                }

                let listHtml = "";
                const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b);

                for (const lvl of sortedLevels) {
                    const itemsAtLevel = byLevel.get(lvl);
                    const priceTag = getFormulaPrice(lvl).label;

                    listHtml += `
                        <div style="margin-bottom: 6px;">
                            <div style="background: #eef2f5; border-left: 3px solid #1976d2; padding: 3px 8px; font-weight: bold; font-size: 0.85em; display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                                <span>Level ${lvl} Formulas (${priceTag} each)</span>
                                <span style="font-size: 0.8em; color: #666;">${itemsAtLevel.length} available</span>
                            </div>
                    `;

                    for (const item of itemsAtLevel) {
                        const isChecked = selectedItems.has(item.uuid);
                        const disabledAttr = item.isKnown ? "disabled" : "";
                        const rowBg = item.isKnown ? "rgba(0,0,0,0.02)" : (isChecked ? "rgba(46, 125, 50, 0.08)" : "#fff");
                        const statusBadge = item.isKnown
                            ? `<span style="background: #e0e0e0; color: #555; padding: 1px 4px; border-radius: 2px; font-size: 0.75em;">Known</span>`
                            : `<span style="font-weight: bold; color: #2e7d32; font-size: 0.85em;">${item.priceLabel}</span>`;

                        const rarityBadge = item.rarity !== "common"
                            ? `<span style="background: #6a1b9a; color: #fff; padding: 1px 4px; border-radius: 2px; font-size: 0.75em; text-transform: capitalize;">${item.rarity}</span>`
                            : "";

                        listHtml += `
                            <div class="bf-formula-row" data-uuid="${escapeHtml(item.uuid)}" style="display: flex; align-items: center; justify-content: space-between; padding: 3px 6px; border-bottom: 1px solid #f0f0f0; background: ${rowBg};">
                                <label style="display: flex; align-items: center; gap: 8px; cursor: ${item.isKnown ? 'default' : 'pointer'}; flex: 1; overflow: hidden; margin: 0;">
                                    <input type="checkbox" class="bf-item-checkbox" data-uuid="${escapeHtml(item.uuid)}" ${isChecked ? 'checked' : ''} ${disabledAttr} />
                                    <img src="${escapeHtml(item.img)}" width="22" height="22" style="border: none; border-radius: 2px; flex-shrink: 0;" />
                                    <span class="bf-item-name" style="font-size: 0.9em; font-weight: ${isChecked ? 'bold' : 'normal'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${item.isKnown ? '#777' : '#222'};">
                                        ${escapeHtml(item.name)}
                                    </span>
                                </label>
                                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
                                    <span style="font-size: 0.75em; color: #666; background: rgba(0,0,0,0.04); padding: 1px 4px; border-radius: 2px;">${escapeHtml(item.subcategory)}</span>
                                    ${rarityBadge}
                                    ${statusBadge}
                                    <a class="bf-item-info" data-uuid="${escapeHtml(item.uuid)}" title="View Item Details" style="color: #666; cursor: pointer; padding: 0 2px;">
                                        <i class="fas fa-info-circle"></i>
                                    </a>
                                </div>
                            </div>
                        `;
                    }

                    listHtml += `</div>`;
                }

                html.find("#bf-list-container").html(listHtml);
            };

            // Event Listeners:
            // 1. Tab switches
            html.find(".bf-tab-btn").on("click", function () {
                activeTab = $(this).data("tab");
                html.find(".bf-tab-btn").each(function () {
                    const isCurrent = $(this).data("tab") === activeTab;
                    $(this).css({
                        "background": isCurrent ? "#fff" : "#e0e0e0",
                        "border-bottom": isCurrent ? "2px solid #fff" : "none"
                    });
                });
                updateCategoryDropdown();
                renderFormulaList();
            });

            // 2. Filters
            html.find("#bf-search-input").on("input", renderFormulaList);
            html.find("#bf-category-select").on("change", renderFormulaList);
            html.find("#bf-level-select").on("change", renderFormulaList);
            html.find("#bf-common-only").on("change", renderFormulaList);
            html.find("#bf-hide-known").on("change", renderFormulaList);

            // 3. Item Selection
            html.on("change", ".bf-item-checkbox", function () {
                const uuid = $(this).data("uuid");
                const item = candidateItems.find(i => i.uuid === uuid);
                if (!item) return;

                if ($(this).is(":checked")) {
                    selectedItems.set(uuid, item);
                    $(this).closest(".bf-formula-row").css("background", "rgba(46, 125, 50, 0.08)").find(".bf-item-name").css("font-weight", "bold");
                } else {
                    selectedItems.delete(uuid);
                    $(this).closest(".bf-formula-row").css("background", "#fff").find(".bf-item-name").css("font-weight", "normal");
                }
                updateCartSummary();
            });

            // 4. View item details
            html.on("click", ".bf-item-info", async function (e) {
                e.preventDefault();
                e.stopPropagation();
                const uuid = $(this).data("uuid");
                if (uuid) {
                    const doc = await fromUuid(uuid);
                    if (doc?.sheet) doc.sheet.render(true);
                }
            });

            // 5. Select Visible / Clear Selection
            html.find("#bf-select-visible").on("click", () => {
                html.find(".bf-item-checkbox:not(:disabled)").each(function () {
                    const uuid = $(this).data("uuid");
                    const item = candidateItems.find(i => i.uuid === uuid);
                    if (item) {
                        $(this).prop("checked", true);
                        selectedItems.set(uuid, item);
                        $(this).closest(".bf-formula-row").css("background", "rgba(46, 125, 50, 0.08)").find(".bf-item-name").css("font-weight", "bold");
                    }
                });
                updateCartSummary();
            });

            html.find("#bf-clear-selection").on("click", () => {
                selectedItems.clear();
                html.find(".bf-item-checkbox").prop("checked", false);
                html.find(".bf-formula-row:not([data-known='true'])").css("background", "#fff").find(".bf-item-name").css("font-weight", "normal");
                updateCartSummary();
            });

            // Initialize view
            updateCategoryDropdown();
            renderFormulaList();
            updateCartSummary();
        }
    }, { width: 680, height: 620, resizable: true });

    dialog.render(true);
}

