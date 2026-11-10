/**
 * PF2e Open Party Stash Macro
 * 
 * Features:
 * - Opens the Party Sheet directly to the Stash (Inventory) tab with a single click.
 * - Automatically finds the active Party actor or the party the player's character belongs to.
 * - If multiple parties exist and the user holds Shift (or calls with { choose: true }),
 *   prompts with a selection dialog.
 * - Restores and focuses the sheet if it was already open or minimized.
 * - Switches to the 'inventory' tab across Foundry VTT v11-v14, ApplicationV1, and ApplicationV2.
 * - Provides clear feedback if no Party actor exists or if permissions are missing.
 */

export const OPEN_PARTY_STASH_MACRO_NAME = "Open Party Stash";
export const OPEN_PARTY_STASH_MACRO_ICON = "icons/containers/chest/chest-reinforced-steel-oak-tan.webp";

/**
 * Finds the appropriate Party actor for the current user.
 */
function getPartyActor() {
    const allParties = game.actors.filter(a => a.type === "party");
    if (allParties.length === 0) return null;

    // 1. If the current user has an assigned character or controlled token, look for their party
    const character = game.user.character || canvas?.tokens?.controlled?.[0]?.actor;
    if (character) {
        const userParty = allParties.find(p => {
            if (p.members?.some(m => m.id === character.id || m.uuid === character.uuid)) return true;
            if (p.system?.members?.some(m => m.uuid?.includes(character.id) || m.id === character.id)) return true;
            return false;
        });
        if (userParty) return userParty;
    }

    // 2. System active party
    if (game.actors.party) {
        return game.actors.party;
    }

    // 3. Any party marked active in system data
    const activeParty = allParties.find(p => p.system?.active);
    if (activeParty) return activeParty;

    // 4. Default to first party
    return allParties[0];
}

/**
 * Activates the inventory / stash tab on the given party sheet.
 */
function activateInventoryTab(sheet, html = null) {
    if (!sheet) return false;
    let activated = false;

    // Method 1: Internal Tab Controllers (ApplicationV1 / Tabs)
    if (sheet._tabs && Array.isArray(sheet._tabs)) {
        for (const tab of sheet._tabs) {
            if (typeof tab.activate === "function") {
                try {
                    tab.activate("inventory");
                    activated = true;
                } catch (_) {}
            }
        }
    }

    // Method 2: ApplicationV2 changeTab API (Foundry v12+ / v14)
    if (typeof sheet.changeTab === "function") {
        try {
            sheet.changeTab("inventory", "primary");
            activated = true;
        } catch (_) {
            try {
                sheet.changeTab("inventory");
                activated = true;
            } catch (_) {}
        }
    }

    // Method 3: DOM-based activation (Native click on tab element)
    const root = html 
        ? (html instanceof HTMLElement ? html : html[0]) 
        : (sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0]);

    if (root) {
        const tabBtn = root.querySelector(
            'nav [data-tab="inventory"], nav.sheet-tabs [data-tab="inventory"], [data-tab="inventory"], nav [data-tab="stash"], [data-tab="stash"]'
        );
        if (tabBtn) {
            if (!tabBtn.classList.contains("active")) {
                tabBtn.click();
            }
            activated = true;
        }
    }

    return activated;
}

/**
 * Renders the given party sheet and ensures the inventory / stash tab is selected.
 */
async function renderPartyStash(party) {
    if (!party) return;

    // Permission check
    const hasPermission = party.testUserPermission 
        ? party.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED) 
        : party.visible;

    if (!hasPermission && !game.user.isGM) {
        return ui.notifications.warn(`You do not have permission to view the Party Sheet for "${party.name}". Please ask your Game Master to configure permissions.`);
    }

    const sheet = party.sheet;
    if (!sheet) {
        return ui.notifications.error(`Party "${party.name}" has no sheet configured.`);
    }

    // Restore if minimized
    if (sheet._minimized) {
        try { sheet.maximize(); } catch (_) {}
    }

    // Setup one-time render hooks for both ApplicationV1 and ApplicationV2
    const hookId = Hooks.once("renderActorSheet", (app, html) => {
        if (app === sheet || app.actor?.id === party.id) {
            activateInventoryTab(sheet, html);
        }
    });

    const hookIdV2 = Hooks.once("renderApplication", (app, html) => {
        if (app === sheet || app.actor?.id === party.id) {
            activateInventoryTab(sheet, html);
        }
    });

    // Render the sheet with the inventory tab requested
    try {
        await sheet.render(true, { focus: true, tab: "inventory" });
    } catch (err) {
        console.error("PF2e Awesome Macros For Players | Failed to render party sheet:", err);
        return ui.notifications.error(`Could not open Party Sheet for "${party.name}".`);
    }

    // Bring window to top
    sheet.bringToTop?.();

    // Trigger tab activation immediately in case it was already open/rendered
    activateInventoryTab(sheet);

    // Staggered timeouts to catch DOM rendering in case hooks don't fire
    [50, 150, 300].forEach(delay => {
        setTimeout(() => activateInventoryTab(sheet), delay);
    });

    // Clean up hooks after 1 second
    setTimeout(() => {
        Hooks.off("renderActorSheet", hookId);
        Hooks.off("renderApplication", hookIdV2);
    }, 1000);
}

/**
 * Prompts user to select from multiple party sheets.
 */
function promptPartySelection(allParties) {
    const optionsHtml = allParties.map(p => {
        const memberNames = p.members?.map(m => m.name).join(", ") || "No members";
        const isCurrent = p === game.actors.party ? " <span style='color: #2e7d32; font-size: 0.85em;'>(Active Party)</span>" : "";
        return `
            <div style="margin-bottom: 8px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <div style="overflow: hidden;">
                    <div style="font-weight: bold; font-size: 1.05em;">${p.name}${isCurrent}</div>
                    <div style="font-size: 0.85em; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Members: ${memberNames}</div>
                </div>
                <button type="button" class="select-party-btn" data-party-id="${p.id}" style="width: auto; padding: 4px 12px; white-space: nowrap; flex-shrink: 0; cursor: pointer;">
                    <i class="fas fa-box-open"></i> Open Stash
                </button>
            </div>
        `;
    }).join("");

    const content = `
        <div style="font-family: 'Signika', sans-serif;">
            <p style="margin-top: 0; margin-bottom: 10px;">Select a party to open its Stash (Inventory):</p>
            ${optionsHtml}
        </div>
    `;

    const dialog = new Dialog({
        title: "Open Party Stash",
        content,
        buttons: {
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "cancel",
        render: (html) => {
            html.find(".select-party-btn").on("click", (ev) => {
                const partyId = ev.currentTarget.dataset.partyId;
                const chosen = allParties.find(p => p.id === partyId);
                if (chosen) {
                    dialog.close();
                    renderPartyStash(chosen);
                }
            });
        }
    });

    dialog.render(true);
}

/**
 * Main macro execution.
 * @param {Object} [options]
 * @param {boolean} [options.choose=false] Force display party selection dialog if multiple parties exist.
 */
export async function openPartyStash(options = {}) {
    const allParties = game.actors.filter(a => a.type === "party");

    if (allParties.length === 0) {
        return ui.notifications.warn("No Party actor found in this world. A Game Master must create a Party actor in the Actors directory.");
    }

    const isShiftHeld = game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS?.SHIFT) ?? false;
    const shouldPrompt = options.choose || (allParties.length > 1 && isShiftHeld);

    if (shouldPrompt) {
        return promptPartySelection(allParties);
    }

    const party = getPartyActor();
    if (!party) {
        return ui.notifications.warn("Could not determine the active Party actor.");
    }

    return renderPartyStash(party);
}
