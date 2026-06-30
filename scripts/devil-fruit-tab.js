const MODULE_ID = "devil-fruit-tab";

const TAB_ID_FRUIT = "devil-fruit";
const TAB_ID_HAKI  = "devil-haki";

const TEMPLATE_PATH = `/modules/${MODULE_ID}/templates/devil-fruit-tab.hbs`;

const ICON_FRUIT = `/modules/${MODULE_ID}/assets/apple.webp`;
const ICON_HAKI  = null;

const PARAMECIA_MAX = [0, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const LOGIA_MAX     = [0, 2, 2, 3, 3, 4, 4, 5, 6, 7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

const SPELL_POINTS_BY_LEVEL = {
  1: 4,  2: 6,  3: 14,  4: 17,  5: 27,
  6: 32, 7: 38, 8: 44, 9: 57, 10: 64,
  11: 73, 12: 73, 13: 83, 14: 83, 15: 94,
  16: 94, 17: 107, 18: 114, 19: 123, 20: 133
};

const _lastLongRefillAt = new Map(); // key: actor.uuid, value: ms timestamp
function shouldDebounceLongRefill(actor) {
  const now = Date.now();
  const last = _lastLongRefillAt.get(actor.uuid) ?? 0;
  if (now - last < 800) return true;
  _lastLongRefillAt.set(actor.uuid, now);
  return false;
}

Hooks.once("init", async () => {
  await loadTemplates([TEMPLATE_PATH]);
  if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);
  injectRuntimeCssOnce();

  game.settings.register(MODULE_ID, "useAlternativeFruitCharges", {
    name: "Direbunny20 Alternative Charges",
    hint: "If enabled: Max charges use Spell Points by Level (Logia uses level, Paramecia uses ceil(level/2), Zoan uses ceil(level/3), Haki uses Zoan, Haki Purist uses Logia). Long rest regains charges based on type. No short rest regain.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

Hooks.on("dnd5e.restCompleted", async (actor, data) => {
  if (!actor) return;

  const isLong =
    data?.restType === "long" ||
    data?.longRest === true ||
    data?.long === true;

  if (!isLong) return;
  if (shouldDebounceLongRefill(actor)) return;

  await refillCharges(actor, "fruit");
  await refillCharges(actor, "haki");
});

Hooks.on("dnd5e.longRest", async (actor) => {
  if (!actor) return;
  if (shouldDebounceLongRefill(actor)) return;

  await refillCharges(actor, "fruit");
  await refillCharges(actor, "haki");
});

Hooks.once("tidy5e-sheet.ready", (api) => {
  try {
    const HandlebarsTab = api?.models?.HandlebarsTab;
    if (!HandlebarsTab) return;

    const makeTab = (mode) => new HandlebarsTab({
      title: mode === "haki" ? "Haki" : "Devil Fruits",
      tabId: mode === "haki" ? TAB_ID_HAKI : TAB_ID_FRUIT,
      iconClass: mode === "haki" ? "dft-tab-icon-haki" : "dft-tab-icon-fruit",
      path: TEMPLATE_PATH,
      getData: async (context) => {
        const actor = context?.actor ?? context?.document ?? context?.app?.document;
        return buildTemplateData(actor, mode);
      },
      onRender: (params) => {
        const rootEl = params?.tabContentsElement ?? params?.element;
        const actor = params?.app?.document ?? params?.app?.actor ?? params?.actor;
        wireTabInteractions(rootEl, actor, mode);

        const sheetRoot = params?.app?.element?.[0] ?? params?.app?.element ?? document;
        hideManagedItemsInSheet(sheetRoot, actor);
      }
    });

    api?.registerCharacterTab?.(makeTab("fruit"));
    api?.registerCharacterTab?.(makeTab("haki"));

    api?.registerNpcTab?.(makeTab("fruit"));
    api?.registerNpcTab?.(makeTab("haki"));

    api?.registerVehicleTab?.(makeTab("fruit"));
    api?.registerVehicleTab?.(makeTab("haki"));
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to register Tidy tabs`, err);
  }
});

Hooks.on("renderActorSheetV2", async (sheet, element) => {
  try {
    const actor = sheet?.actor ?? sheet?.document;
    if (!actor || !["character", "npc", "vehicle"].includes(actor.type)) return;

    // tidy handled above, but still hide managed items
    if (element?.classList?.contains("tidy5e-sheet")) {
      hideManagedItemsInSheet(element, actor);
      return;
    }

    await injectCoreTabs(sheet, element, actor);
    hideManagedItemsInSheet(element, actor);
  } catch (err) {
    console.error(`${MODULE_ID} | renderActorSheetV2 error`, err);
  }
});

async function injectCoreTabs(sheet, element, actor) {
  const nav =
    element.querySelector('nav.tabs[data-group]') ||
    element.querySelector('nav.sheet-tabs[data-group]') ||
    element.querySelector("nav.tabs") ||
    element.querySelector("nav.sheet-tabs") ||
    element.querySelector("nav[data-group]");
  if (!nav) return;

  const group = nav.dataset.group ?? "primary";

  const panelFruit = findOrCreateCorePanel(element, group, TAB_ID_FRUIT);
  const panelHaki  = findOrCreateCorePanel(element, group, TAB_ID_HAKI);

  await renderTabContents(panelFruit, actor, "fruit");
  await renderTabContents(panelHaki, actor, "haki");

  wireTabInteractions(panelFruit, actor, "fruit");
  wireTabInteractions(panelHaki, actor, "haki");

  if (!nav.querySelector(`[data-tab="${TAB_ID_FRUIT}"][data-group="${group}"]`)) {
    nav.appendChild(makeCoreTabButton(nav, sheet, element, group, TAB_ID_FRUIT, "Devil Fruits", ICON_FRUIT, panelFruit));
  }

  if (!nav.querySelector(`[data-tab="${TAB_ID_HAKI}"][data-group="${group}"]`)) {
    nav.appendChild(makeCoreTabButton(nav, sheet, element, group, TAB_ID_HAKI, "Haki", ICON_HAKI, panelHaki));
  }
}

function makeCoreTabButton(nav, sheet, element, group, tabId, title, iconPath, panel) {
  const sample = nav.querySelector(":scope > *");
  const tabEl = document.createElement("button");
  if (sample?.className) tabEl.className = sample.className;
  tabEl.classList.add("item");
  tabEl.type = "button";
  tabEl.dataset.tab = tabId;
  tabEl.dataset.group = group;
  tabEl.dataset.action = "tab";
  tabEl.title = title;

  tabEl.innerHTML = iconPath
    ? `
      <img class="dft-tab-icon-img" src="${iconPath}" alt="" />
      <span class="dft-sr-only">${title}</span>
    `
    : `
      <i class="fa-solid fa-shield-halved dft-tab-icon-fa" aria-hidden="true"></i>
      <span class="dft-sr-only">${title}</span>
    `;

  if (!tabEl.dataset.dftBound) {
    tabEl.dataset.dftBound = "1";
    tabEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      if (typeof sheet.changeTab === "function") {
        sheet.changeTab(tabId, group);
        return;
      }

      nav.querySelectorAll(`.item[data-group="${group}"]`).forEach((n) => {
        n.classList.toggle("active", n === tabEl);
        n.setAttribute("aria-selected", n === tabEl ? "true" : "false");
      });

      const contentRoot = panel.parentElement ?? element;
      contentRoot.querySelectorAll(`.tab[data-group="${group}"]`).forEach((p) => {
        const isActive = p.dataset.tab === tabId;
        p.classList.toggle("active", isActive);
        p.style.display = isActive ? "" : "none";
      });
    });
  }

  return tabEl;
}

function findOrCreateCorePanel(element, group, tabId) {
  const existingPanel = element.querySelector(`.tab[data-group="${group}"]`);
  const contentRoot =
    existingPanel?.parentElement ||
    element.querySelector(".sheet-body") ||
    element.querySelector("section.sheet-body") ||
    element.querySelector(".window-content") ||
    element;

  let panel = contentRoot.querySelector(`.tab[data-tab="${tabId}"][data-group="${group}"]`);
  if (!panel) {
    panel = document.createElement("section");
    panel.classList.add("tab");
    panel.dataset.tab = tabId;
    panel.dataset.group = group;
    contentRoot.appendChild(panel);
  }
  return panel;
}

async function renderTabContents(panelEl, actor, mode) {
  if (!panelEl || !actor) return;
  const data = buildTemplateData(actor, mode);
  panelEl.innerHTML = await renderTemplate(TEMPLATE_PATH, data);
}

function isManagedItem(item) {
  return Boolean(item?.getFlag?.(MODULE_ID, "dfManaged") || item?.getFlag?.(MODULE_ID, "devilFruit") || item?.getFlag?.(MODULE_ID, "haki"));
}

function getManagedMode(item) {
  const cat = item?.getFlag?.(MODULE_ID, "dftCategory");
  if (cat === "haki" || item?.getFlag?.(MODULE_ID, "haki")) return "haki";
  // legacy devilFruit items default to fruit
  return "fruit";
}

function getManagedItems(actor, mode) {
  return (actor?.items?.contents ?? []).filter((i) => isManagedItem(i) && getManagedMode(i) === mode);
}

function parseCrValue(cr) {
  if (cr == null) return 0;
  if (typeof cr === "number") return cr;
  const s = String(cr).trim();
  if (!s) return 0;
  if (s.includes("/")) {
    const [a, b] = s.split("/");
    const num = Number(a);
    const den = Number(b);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function getActorCR(actor) {
  const cr =
    foundry.utils.getProperty(actor, "system.details.cr") ??
    foundry.utils.getProperty(actor, "system.details.challenge") ??
    foundry.utils.getProperty(actor, "system.attributes.cr") ??
    null;
  return parseCrValue(cr);
}

function getNpcCrHalfUpMin1(actor) {
  const cr = getActorCR(actor);
  return Math.max(1, Math.ceil(cr / 2));
}

function getNpcDevilFruitChargesByCR(actor) {
  const cr = getActorCR(actor);

  if (cr <= 2) return 2;
  if (cr <= 5) return 5;
  if (cr <= 10) return 10;
  if (cr <= 15) return 15;
  if (cr <= 20) return 20;
  if (cr <= 25) return 22;
  return 24;
}

function isAltChargesEnabled() {
  return game.settings.get(MODULE_ID, "useAlternativeFruitCharges") === true;
}

function getSpellPointsForLevel(level) {
  const lvl = clamp(Math.floor(level), 1, 20);
  return SPELL_POINTS_BY_LEVEL[lvl] ?? 0;
}

function getAltMaxCharges(type, level) {
  const lvl = clamp(Math.floor(level), 1, 20);

  let effectiveLevel = lvl;

  if (type === "paramecia") effectiveLevel = Math.ceil(lvl / 2);
  if (type === "zoan" || type === "haki") effectiveLevel = Math.ceil(lvl / 3);

  return getSpellPointsForLevel(effectiveLevel);
}

function getHighestSpellLevelByType(type, level) {
  const lvl = clamp(Math.floor(level), 1, 20);

  if (type === "logia" || type === "hakiPurist") {
    return Math.min(9, Math.floor((lvl + 1) / 2));
  }

  if (type === "paramecia") {
    return Math.min(5, Math.floor((lvl - 1) / 4) + 1);
  }

  if (type === "zoan" || type === "haki") {
    return Math.min(4, Math.floor((lvl - 1) / 6) + 1);
  }

  return Math.min(5, Math.floor((lvl - 1) / 4) + 1);
}

function getChargesMaxBaseForActor(actor, type, level) {
  if (isAltChargesEnabled()) {
    return getAltMaxCharges(type, level);
  }

  return getChargesMaxBase(type, level);
}

function modeFlag(mode, key) {
  if (mode === "fruit") {
    return {
      type: "fruitType",
      name: "fruitName",
      img: "fruitImg",
      bonus: "bonusCharges",
      cur: "chargesCurrent",
      stat: "castingStat",
      last: "lastAppliedCastingStat",
      npcScaling: "fruitNpcScaling",
      npcCasterLevel: "fruitNpcCasterLevel",
      npcMaxSpellLevel: "fruitNpcMaxSpellLevel"
    }[key];
  }

  return {
    type: "hakiType",
    name: "hakiName",
    img: "hakiImg",
    bonus: "hakiBonusCharges",
    cur: "hakiChargesCurrent",
    stat: "hakiCastingStat",
    last: "hakiLastAppliedCastingStat",
    npcScaling: "hakiNpcScaling",
    npcCasterLevel: "hakiNpcCasterLevel",
    npcMaxSpellLevel: "hakiMaxSpellLevel"
  }[key];
}

// NPC scaling defaults on for NPC actors, but can be explicitly toggled per tab.
function isNpcScalingEnabled(actor, mode) {
  const stored = actor.getFlag(MODULE_ID, modeFlag(mode, "npcScaling"));
  if (stored === undefined || stored === null) return actor?.type === "npc";
  return Boolean(stored);
}

// Manual caster level wins; otherwise NPC scaling treats CR as an effective level.
function getNpcEffectiveCasterLevel(actor, mode) {
  const override = Number(actor.getFlag(MODULE_ID, modeFlag(mode, "npcCasterLevel")));
  if (Number.isFinite(override) && override > 0) return clamp(Math.floor(override), 1, 20);

  const cr = getActorCR(actor);
  return clamp(Math.max(1, Math.ceil(cr)), 1, 20);
}

// Devil Fruit/Haki power scaling uses NPC CR/override only when the tab opts into it.
function getEffectivePowerLevel(actor, mode) {
  if (isNpcScalingEnabled(actor, mode)) return getNpcEffectiveCasterLevel(actor, mode);
  return getActorLevel(actor);
}

// Manual spell-level caps apply only while NPC scaling is enabled for this tab.
function getEffectiveHighestSpellLevel(actor, mode, type) {
  const override = Number(actor.getFlag(MODULE_ID, modeFlag(mode, "npcMaxSpellLevel")));
  if (isNpcScalingEnabled(actor, mode) && Number.isFinite(override) && override >= 0) {
    return clamp(Math.floor(override), 0, 9);
  }

  const effectiveLevel = getEffectivePowerLevel(actor, mode);
  return getHighestSpellLevelByType(type, effectiveLevel);
}

function buildTemplateData(actor, mode = "fruit") {
  const typeKey = modeFlag(mode, "type");
  const nameKey = modeFlag(mode, "name");
  const imgKey  = modeFlag(mode, "img");
  const bonusKey = modeFlag(mode, "bonus");
  const curKey = modeFlag(mode, "cur");
  const statKey = modeFlag(mode, "stat");

  const fruitType =
    (actor.getFlag(MODULE_ID, typeKey) ??
      (mode === "haki" ? "haki" : "paramecia"));

  const fruitName =
    (actor.getFlag(MODULE_ID, nameKey) ??
      (mode === "haki" ? "Haki" : "Devil Fruit"));

  const fruitImg = (actor.getFlag(MODULE_ID, imgKey) ?? null);
  const bonusCharges = Number(actor.getFlag(MODULE_ID, bonusKey) ?? 0);

  const castingStat = (actor.getFlag(MODULE_ID, statKey) ?? "cha");
  const { saveDC: fruitSaveDC, attackModSigned: fruitAttackModSigned } =
    computeCastingStats(actor, castingStat);

  const level = getEffectivePowerLevel(actor, mode);
  const highestSpellLevel = getEffectiveHighestSpellLevel(actor, mode, fruitType);

  const chargesMaxBase = getChargesMaxBaseForActor(actor, fruitType, level);
  const chargesMax = Math.max(0, chargesMaxBase + bonusCharges);

  const showCharges = chargesMax > 0;

  const storedCurrent = actor.getFlag(MODULE_ID, curKey);
  const chargesCurrentRaw = Number.isFinite(Number(storedCurrent)) ? Number(storedCurrent) : chargesMax;
  const chargesCurrent = clamp(chargesCurrentRaw, 0, chargesMax);
  const chargePct = showCharges && chargesMax > 0 ? (chargesCurrent / chargesMax) * 100 : 0;

  const managed = getManagedItems(actor, mode).map((i) => {
    const defaultMode = i.getFlag(MODULE_ID, "defaultCastLevelMode") ?? "ask";
    const defaultCastLevelMode = ["ask", "base", "highest"].includes(defaultMode) ? defaultMode : "ask";
    const baseSpellLevel = Number(i.system?.level ?? i.system?.spellLevel ?? 0);

    return {
      uuid: i.uuid,
      id: i.id,
      name: i.name,
      img: i.img,
      type: i.type,
      chargeCost: Number(i.getFlag(MODULE_ID, "chargeCost") ?? 0),
      allowUpcast: Boolean(i.getFlag(MODULE_ID, "allowUpcast")),
      upcastCost: Number(i.getFlag(MODULE_ID, "upcastCost") ?? 0),
      defaultCastLevelMode,
      baseSpellLevel,
      maxSpellLevel: highestSpellLevel,
      spellLevel: baseSpellLevel
    };
  });

  const spells = managed.filter((i) => i.type === "spell");
  const attacks = managed.filter((i) => i.type === "weapon");
  const features = managed.filter((i) => i.type === "feat");
  const other = managed.filter((i) => !["spell", "weapon", "feat"].includes(i.type));

  return {
    mode,
    isGM: game.user.isGM,
    isNpcActor: actor.type === "npc",

    fruitType,
    fruitName,
    fruitImg,

    castingStat,
    fruitSaveDC,
    fruitAttackModSigned,
    highestSpellLevel,
    effectivePowerLevel: level,
    npcScaling: isNpcScalingEnabled(actor, mode),
    npcCasterLevel: actor.getFlag(MODULE_ID, modeFlag(mode, "npcCasterLevel")) ?? "",
    npcMaxSpellLevel: actor.getFlag(MODULE_ID, modeFlag(mode, "npcMaxSpellLevel")) ?? "",
    actorCR: getActorCR(actor),

    showCharges,
    chargesCurrent,
    chargesMax,
    chargePct: Math.round(chargePct),
    bonusCharges,

    spells,
    attacks,
    features,
    other,
    hasAny: managed.length > 0
  };
}

function wireTabInteractions(rootEl, actor, mode = "fruit") {
  if (!rootEl || !actor) return;

  const lastKey = modeFlag(mode, "last");
  const statKey = modeFlag(mode, "stat");

  if (!rootEl.dataset.dftAutosynced) {
    rootEl.dataset.dftAutosynced = "1";
    queueMicrotask(async () => {
      try {
        const desired = actor.getFlag(MODULE_ID, statKey) ?? "cha";
        const last = actor.getFlag(MODULE_ID, lastKey) ?? null;
        if (last !== desired) {
          await applyCastingStatToAllManagedItems(actor, desired, mode);
          await actor.setFlag(MODULE_ID, lastKey, desired);
          rerenderAllActorSheets(actor);
        }
      } catch (e) {
        console.warn(`${MODULE_ID} | autosync failed`, e);
      }
    });
  }

  const typeSelect = rootEl.querySelector('[data-action="set-type"]');
  if (typeSelect && !typeSelect.dataset.dftWired) {
    typeSelect.dataset.dftWired = "1";
    typeSelect.addEventListener("change", async (ev) => {
      const nextType = ev.target?.value ?? (mode === "haki" ? "haki" : "paramecia");
      await actor.setFlag(MODULE_ID, modeFlag(mode, "type"), nextType);
      await reconcileChargesForMode(actor, mode);
      rerenderAllActorSheets(actor);
    });
  }

  const statSelect = rootEl.querySelector('[data-action="set-casting-stat"]');
  if (statSelect && !statSelect.dataset.dftWired) {
    statSelect.dataset.dftWired = "1";
    statSelect.addEventListener("change", async (ev) => {
      const next = ev.target?.value ?? "cha";
      await actor.setFlag(MODULE_ID, statKey, next);

      await applyCastingStatToAllManagedItems(actor, next, mode);
      await actor.setFlag(MODULE_ID, lastKey, next);

      rerenderAllActorSheets(actor);
    });
  }

  const requireGmNpcScalingChange = () => {
    if (game.user.isGM) return true;
    ui.notifications.warn("Only the GM can change NPC scaling.");
    return false;
  };

  const npcScalingInput = rootEl.querySelector('[data-action="set-npc-scaling"]');
  if (npcScalingInput && !npcScalingInput.dataset.dftWired) {
    npcScalingInput.dataset.dftWired = "1";
    npcScalingInput.addEventListener("change", async (ev) => {
      if (!requireGmNpcScalingChange()) return;
      await actor.setFlag(MODULE_ID, modeFlag(mode, "npcScaling"), Boolean(ev.target?.checked));
      await reconcileChargesForMode(actor, mode);
      rerenderAllActorSheets(actor);
    });
  }

  const npcCasterLevelInput = rootEl.querySelector('[data-action="set-npc-caster-level"]');
  if (npcCasterLevelInput && !npcCasterLevelInput.dataset.dftWired) {
    npcCasterLevelInput.dataset.dftWired = "1";
    npcCasterLevelInput.addEventListener("change", async (ev) => {
      if (!requireGmNpcScalingChange()) return;

      const raw = String(ev.target?.value ?? "").trim();
      if (!raw) await actor.unsetFlag(MODULE_ID, modeFlag(mode, "npcCasterLevel"));
      else {
        const next = Number(raw);
        if (!Number.isFinite(next)) {
          ui.notifications.warn("Effective Level must be a number.");
          return;
        }
        await actor.setFlag(MODULE_ID, modeFlag(mode, "npcCasterLevel"), clamp(Math.floor(next), 1, 20));
      }

      await reconcileChargesForMode(actor, mode);
      rerenderAllActorSheets(actor);
    });
  }

  const npcMaxSpellLevelInput = rootEl.querySelector('[data-action="set-npc-max-spell-level"]');
  if (npcMaxSpellLevelInput && !npcMaxSpellLevelInput.dataset.dftWired) {
    npcMaxSpellLevelInput.dataset.dftWired = "1";
    npcMaxSpellLevelInput.addEventListener("change", async (ev) => {
      if (!requireGmNpcScalingChange()) return;

      const raw = String(ev.target?.value ?? "").trim();
      if (!raw) await actor.unsetFlag(MODULE_ID, modeFlag(mode, "npcMaxSpellLevel"));
      else {
        const next = Number(raw);
        if (!Number.isFinite(next)) {
          ui.notifications.warn("Max Spell Level must be a number.");
          return;
        }
        await actor.setFlag(MODULE_ID, modeFlag(mode, "npcMaxSpellLevel"), clamp(Math.floor(next), 0, 9));
      }

      await reconcileChargesForMode(actor, mode);
      rerenderAllActorSheets(actor);
    });
  }

  const plusBtn = rootEl.querySelector('[data-action="charge-plus"]');
  const minusBtn = rootEl.querySelector('[data-action="charge-minus"]');
  const bonusBtn = rootEl.querySelector('[data-action="charge-bonus"]');

  if (plusBtn && !plusBtn.dataset.dftWired) {
    plusBtn.dataset.dftWired = "1";
    plusBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await adjustCharges(actor, +1, mode);
    });
  }
  if (minusBtn && !minusBtn.dataset.dftWired) {
    minusBtn.dataset.dftWired = "1";
    minusBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await adjustCharges(actor, -1, mode);
    });
  }
  if (bonusBtn && !bonusBtn.dataset.dftWired) {
    bonusBtn.dataset.dftWired = "1";
    bonusBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const current = Number(actor.getFlag(MODULE_ID, modeFlag(mode, "bonus")) ?? 0);
      const next = await promptBonusCharges(current);
      if (next === null) return;

      await actor.setFlag(MODULE_ID, modeFlag(mode, "bonus"), next);

      const type = actor.getFlag(MODULE_ID, modeFlag(mode, "type")) ?? (mode === "haki" ? "haki" : "paramecia");
      const level = getEffectivePowerLevel(actor, mode);

      const prevMax = Math.max(0, getChargesMaxBaseForActor(actor, type, level) + Number(current));
      const nextMax = Math.max(0, getChargesMaxBaseForActor(actor, type, level) + Number(next));

      let cur = getChargesCurrentForMode(actor, mode, nextMax);

      // Zoan/Haki: if it went from 0 max to >0 max, fill it.
      if ((type === "zoan" || type === "haki") && prevMax <= 0 && nextMax > 0) cur = nextMax;

      await actor.setFlag(MODULE_ID, modeFlag(mode, "cur"), clamp(cur, 0, nextMax));
      await reconcileChargesForMode(actor, mode);
      rerenderAllActorSheets(actor);
    });
  }

  if (!rootEl.dataset.dftClickBound) {
    rootEl.dataset.dftClickBound = "1";
    rootEl.addEventListener("click", async (ev) => {
      const action = ev.target?.closest("[data-action]")?.dataset?.action;
      if (!action) return;

      const li = ev.target.closest("[data-item-uuid]");
      const uuid = li?.dataset?.itemUuid;
      if (!uuid) return;

      const doc = await fromUuid(uuid).catch(() => null);
      const item = (doc?.documentName === "Item") ? doc : null;
      if (!item) return;

      if (action === "open") return item.sheet?.render(true);

      if (action === "edit") {
        const current = {
          chargeCost: Number(item.getFlag(MODULE_ID, "chargeCost") ?? 0),
          allowUpcast: Boolean(item.getFlag(MODULE_ID, "allowUpcast")),
          upcastCost: Number(item.getFlag(MODULE_ID, "upcastCost") ?? 0),
          defaultCastLevelMode: item.getFlag(MODULE_ID, "defaultCastLevelMode") ?? "ask"
        };
        const updated = await promptItemChargeConfig(item, actor, current, mode);
        if (!updated) return;

        await item.setFlag(MODULE_ID, "chargeCost", updated.chargeCost);
        await item.setFlag(MODULE_ID, "allowUpcast", updated.allowUpcast);
        await item.setFlag(MODULE_ID, "upcastCost", updated.upcastCost);
        await item.setFlag(MODULE_ID, "defaultCastLevelMode", updated.defaultCastLevelMode);

        rerenderAllActorSheets(actor);
        return;
      }

      if (action === "remove") {
        if (item.parent?.uuid === actor.uuid) {
          await item.delete();
          rerenderAllActorSheets(actor);
        }
        return;
      }

      if (action === "use") {
        await usePowerItem(actor, item, mode);
        return;
      }
    });
  }

  if (!rootEl.dataset.dftDropBound) {
    rootEl.dataset.dftDropBound = "1";

    rootEl.addEventListener("dragover", (ev) => {
      const dropTarget = ev.target?.closest?.("[data-dft-drop]");
      if (!dropTarget) return;
      ev.preventDefault();
      ev.stopPropagation();
    }, { capture: true });

    rootEl.addEventListener("drop", async (ev) => {
      const dropTarget = ev.target?.closest?.("[data-dft-drop]");
      if (!dropTarget) return;

      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      const modeLocal = rootEl.dataset.dftMode ?? mode;
      const drop = dropTarget.dataset.dftDrop;

      if (drop === "power") return handlePowerDrop(ev, actor, modeLocal);
      if (drop === "items") return handleItemDrop(ev, actor, modeLocal);
    }, { capture: true });
  }
}

async function handlePowerDrop(event, actor, mode) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can set the image/name.");
    return;
  }

  const data = getDragEventDataSafe(event);
  if (!data?.uuid) return;

  const doc = await fromUuid(data.uuid).catch(() => null);
  if (!doc) return;

  if (doc.documentName !== "JournalEntryPage" || doc.type !== "image") {
    ui.notifications.warn("Drop an Image Journal Page (not a text page).");
    return;
  }

  const src = doc.src || doc.system?.src || doc.image?.src;
  if (!src) {
    ui.notifications.warn("That image page has no src.");
    return;
  }

  await actor.setFlag(MODULE_ID, modeFlag(mode, "img"), src);
  await actor.setFlag(MODULE_ID, modeFlag(mode, "name"), doc.name ?? (mode === "haki" ? "Haki" : "Devil Fruit"));
  rerenderAllActorSheets(actor);
}

async function handleItemDrop(event, actor, mode) {
  const data = getDragEventDataSafe(event);
  if (!data || data.type !== "Item") return;

  const uuid = data.uuid ?? (data.pack && data.id ? `Compendium.${data.pack}.Item.${data.id}` : null);
  if (!uuid) return;

  const dropped = await fromUuid(uuid).catch(() => null);
  if (!dropped || dropped.documentName !== "Item") return;

  if (dropped.parent?.uuid === actor.uuid && isManagedItem(dropped)) return;

  const createData = dropped.toObject();
  delete createData._id;

  createData.flags ??= {};
  createData.flags[MODULE_ID] = {
    ...(createData.flags[MODULE_ID] ?? {}),
    dfManaged: true,
    dftCategory: mode,
    devilFruit: mode === "fruit",
    haki: mode === "haki",
    dfSourceUuid: dropped.uuid
  };

  createData.flags.core ??= {};
  createData.flags.core.sourceId = dropped.uuid;

  const [created] = await actor.createEmbeddedDocuments("Item", [createData]);

  const powerType =
    actor.getFlag(MODULE_ID, modeFlag(mode, "type")) ??
    (mode === "haki" ? "haki" : "paramecia");

  if (powerType !== "zoan" && powerType !== "haki") {
    const cfg = await promptItemChargeConfig(created, actor, null, mode);
    if (cfg) {
      await created.setFlag(MODULE_ID, "chargeCost", cfg.chargeCost);
      await created.setFlag(MODULE_ID, "allowUpcast", cfg.allowUpcast);
      await created.setFlag(MODULE_ID, "upcastCost", cfg.upcastCost);
      await created.setFlag(MODULE_ID, "defaultCastLevelMode", cfg.defaultCastLevelMode);
    }
  } else {
    await created.setFlag(MODULE_ID, "chargeCost", 0);
    await created.setFlag(MODULE_ID, "allowUpcast", false);
    await created.setFlag(MODULE_ID, "upcastCost", 0);
    await created.setFlag(MODULE_ID, "defaultCastLevelMode", "ask");
  }

  const castingStat = actor.getFlag(MODULE_ID, modeFlag(mode, "stat")) ?? "cha";
  await applyCastingStatToItemActivities(created, castingStat, actor);
  await actor.setFlag(MODULE_ID, modeFlag(mode, "last"), castingStat);

  rerenderAllActorSheets(actor);
  if (game.user.isGM) created.sheet?.render(true);
}

async function usePowerItem(actor, item, mode) {
  const powerType =
    actor.getFlag(MODULE_ID, modeFlag(mode, "type")) ??
    (mode === "haki" ? "haki" : "paramecia");

  const levelForMax = getEffectivePowerLevel(actor, mode);
  const bonusForMax = Number(actor.getFlag(MODULE_ID, modeFlag(mode, "bonus")) ?? 0);
  const maxForMax = Math.max(0, getChargesMaxBaseForActor(actor, powerType, levelForMax) + bonusForMax);
  const showCharges = maxForMax > 0;
  const currentCharges = showCharges
    ? getChargesCurrentForMode(actor, mode, maxForMax)
    : Number.POSITIVE_INFINITY;

  let slotLevel = null;
  let baseSpellLevel = null;
  const baseCost = Math.max(0, Math.floor(Number(item.getFlag(MODULE_ID, "chargeCost") ?? 0)));
  let totalCost = baseCost;

  if (item.type === "spell") {
    baseSpellLevel = Math.max(0, Math.floor(Number(item.system?.level ?? item.system?.spellLevel ?? 0)));
    const highestSpellLevel = getEffectiveHighestSpellLevel(actor, mode, powerType);
    const allowUpcast = Boolean(item.getFlag(MODULE_ID, "allowUpcast"));
    const upcastCost = Math.max(0, Math.floor(Number(item.getFlag(MODULE_ID, "upcastCost") ?? 0)));
    const storedDefault = item.getFlag(MODULE_ID, "defaultCastLevelMode") ?? "ask";
    const defaultCastLevelMode = ["ask", "base", "highest"].includes(storedDefault) ? storedDefault : "ask";
    const isUpcastable = allowUpcast && baseSpellLevel > 0 && highestSpellLevel > baseSpellLevel;

    slotLevel = baseSpellLevel;

    if (isUpcastable) {
      if (defaultCastLevelMode === "ask") {
        const chosen = await promptSpellCastLevel(
          item.name,
          baseSpellLevel,
          highestSpellLevel,
          baseCost,
          upcastCost,
          currentCharges
        );
        if (chosen === null) return;
        slotLevel = chosen;
      } else if (defaultCastLevelMode === "highest") {
        const chosen = getHighestAffordableSpellLevel(
          baseSpellLevel,
          highestSpellLevel,
          baseCost,
          upcastCost,
          currentCharges
        );
        if (chosen === null) {
          ui.notifications.warn("Not enough charges to cast this power.");
          return;
        }
        slotLevel = chosen;
      }

      totalCost = getSpellCastCost(slotLevel, baseSpellLevel, baseCost, upcastCost);
    }
  }

  if (showCharges) {
    if (totalCost > currentCharges) {
      ui.notifications.warn(`Not enough charges. Need ${totalCost}, have ${currentCharges}.`);
      return;
    }
  }

  try {
    const usageConfig = { consume: false };
    const dialogConfig = {};

    if (item.type === "spell") {
      dialogConfig.configure = false;
      if (slotLevel > 0) {
        usageConfig.spell = { slot: `spell${slotLevel}` };
        usageConfig.scaling = Math.max(0, slotLevel - (baseSpellLevel ?? slotLevel));
      } else {
        usageConfig.scaling = false;
      }
    }

    const messageConfig = {};
    if (item.type === "spell" && slotLevel > 0) {
      foundry.utils.setProperty(messageConfig, "data.flags.dnd5e.use.spellLevel", slotLevel);
    }

    const result = await item.use(usageConfig, dialogConfig, messageConfig);
    if (result === undefined) return;

    if (showCharges) {
      await actor.setFlag(MODULE_ID, modeFlag(mode, "cur"), clamp(currentCharges - totalCost, 0, maxForMax));
      rerenderAllActorSheets(actor);
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | item.use failed, opening sheet instead`, e);
    item.sheet?.render(true);
  }
}

async function adjustCharges(actor, delta, mode) {
  const powerType =
    actor.getFlag(MODULE_ID, modeFlag(mode, "type")) ??
    (mode === "haki" ? "haki" : "paramecia");

  const level = getEffectivePowerLevel(actor, mode);
  const bonus = Number(actor.getFlag(MODULE_ID, modeFlag(mode, "bonus")) ?? 0);
  const max = Math.max(0, getChargesMaxBaseForActor(actor, powerType, level) + bonus);

  if (max <= 0) return;

  const cur = getChargesCurrentForMode(actor, mode, max);

  await actor.setFlag(MODULE_ID, modeFlag(mode, "cur"), clamp(cur + delta, 0, max));
  rerenderAllActorSheets(actor);
}

async function refillCharges(actor, mode) {
  const powerType =
    actor.getFlag(MODULE_ID, modeFlag(mode, "type")) ??
    (mode === "haki" ? "haki" : "paramecia");

  const level = getEffectivePowerLevel(actor, mode);
  const bonus = Number(actor.getFlag(MODULE_ID, modeFlag(mode, "bonus")) ?? 0);
  const max = Math.max(0, getChargesMaxBaseForActor(actor, powerType, level) + bonus);

  if (max <= 0) return;

  // Standard: full refill
  if (!isAltChargesEnabled()) {
    await actor.setFlag(MODULE_ID, modeFlag(mode, "cur"), max);
    rerenderAllActorSheets(actor);
    return;
  }

  let regain = 0;

  if (powerType === "logia" || powerType === "hakiPurist") regain = level;
  else if (powerType === "paramecia") regain = Math.ceil(level / 2);
  else if (powerType === "zoan" || powerType === "haki") regain = Math.ceil(level / 3);
  else regain = Math.ceil(level / 2);

  const cur = getChargesCurrentForMode(actor, mode, max);
  await actor.setFlag(MODULE_ID, modeFlag(mode, "cur"), clamp(cur + regain, 0, max));
  rerenderAllActorSheets(actor);
}

function halfUpFormula(varPath) {
  return `floor((${varPath} + 1) / 2)`;
}

function getFormulasForStat(stat, actor) {
  if (stat === "willpower") {
    if (actor?.type === "npc") {
      const half = getNpcCrHalfUpMin1(actor);
      return {
        dcFormula: `10 + ${half}`,
        atkFormula: `8 + ${half}`
      };
    }

    const halfUp = halfUpFormula("@willpower.total");
    return {
      dcFormula: `10 + ${halfUp}`,
      atkFormula: `2 + ${halfUp}`
    };
  }

  return {
    dcFormula: `10 + @prof + @abilities.${stat}.mod`,
    atkFormula: `2 + @prof + @abilities.${stat}.mod`
  };
}

function listActivityIds(item) {
  const acts = item?.system?.activities;
  if (!acts) return [];
  if (typeof acts === "object") return Object.keys(acts);
  return [];
}

async function applyCastingStatToItemActivities(item, castingStat, actor) {
  const { dcFormula, atkFormula } = getFormulasForStat(castingStat, actor);
  const ids = listActivityIds(item);
  if (!ids.length) return;

  const update = {};

  for (const id of ids) {
    const base = `system.activities.${id}`;

    if (foundry.utils.hasProperty(item, `${base}.save.dc`)) {
      foundry.utils.setProperty(update, `${base}.save.dc.calculation`, "formula");
      foundry.utils.setProperty(update, `${base}.save.dc.formula`, dcFormula);
    }

    if (foundry.utils.hasProperty(item, `${base}.attack`)) {
      foundry.utils.setProperty(update, `${base}.attack.flat`, true);
      foundry.utils.setProperty(update, `${base}.attack.ability`, "none");
      foundry.utils.setProperty(update, `${base}.attack.bonus`, atkFormula);
    }
  }

  if (!Object.keys(update).length) return;

  try {
    await item.update(update);
  } catch (e) {
    console.warn(`${MODULE_ID} | Failed to apply formulas to ${item.name}`, e, update);
  }
}

async function applyCastingStatToAllManagedItems(actor, castingStat, mode) {
  const items = getManagedItems(actor, mode);
  for (const item of items) {
    await applyCastingStatToItemActivities(item, castingStat, actor);
  }
}

function promptItemChargeConfig(item, actor, existing, mode) {
  const powerType =
    actor.getFlag(MODULE_ID, modeFlag(mode, "type")) ??
    (mode === "haki" ? "haki" : "paramecia");

  const isSpell = item.type === "spell";

  const chargeCost = existing ? Number(existing.chargeCost ?? 0) : 1;
  const allowUpcast = existing ? Boolean(existing.allowUpcast) : false;
  const upcastCost = existing ? Number(existing.upcastCost ?? 0) : 1;
  const storedDefault = existing?.defaultCastLevelMode ?? "ask";
  const defaultCastLevelMode = ["ask", "base", "highest"].includes(storedDefault) ? storedDefault : "ask";

  const content = `
    <form class="dft-form">
      <div class="form-group">
        <label>How many charges does this take?</label>
        <input type="number" name="chargeCost" value="${chargeCost}" min="0" step="1"/>
      </div>

      ${isSpell ? `
        <hr/>
        <div class="form-group">
          <label>
            <input type="checkbox" name="allowUpcast" ${allowUpcast ? "checked" : ""}/>
            Can this spell be upcast?
          </label>
        </div>
        <div class="form-group">
          <label>Upcast cost (per level upcast)</label>
          <input type="number" name="upcastCost" value="${upcastCost}" min="0" step="1"/>
        </div>
        <div class="form-group">
          <label>Default cast level</label>
          <select name="defaultCastLevelMode">
            <option value="ask" ${defaultCastLevelMode === "ask" ? "selected" : ""}>Ask each time</option>
            <option value="base" ${defaultCastLevelMode === "base" ? "selected" : ""}>Base level</option>
            <option value="highest" ${defaultCastLevelMode === "highest" ? "selected" : ""}>Highest available</option>
          </select>
        </div>
      ` : ``}

      ${(powerType === "zoan" || powerType === "haki") ? `<p><em>Note: ${powerType === "haki" ? "Haki" : "Zoan"} does not use charges by default (cost will be ignored).</em></p>` : ``}
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: `Cost: ${item.name}`,
      content,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Save",
          callback: (html) => {
            const form = html[0].querySelector("form");
            const cc = Number(form.chargeCost.value ?? 0);
            const au = isSpell ? Boolean(form.allowUpcast.checked) : false;
            const uc = isSpell ? Number(form.upcastCost.value ?? 0) : 0;
            const dm = isSpell ? form.defaultCastLevelMode.value : "ask";
            resolve({
              chargeCost: Math.max(0, Math.floor(cc)),
              allowUpcast: au,
              upcastCost: Math.max(0, Math.floor(uc)),
              defaultCastLevelMode: ["ask", "base", "highest"].includes(dm) ? dm : "ask"
            });
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-xmark"></i>',
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

function getSpellCastCost(level, baseLevel, baseCost, upcastCost) {
  return baseCost + Math.max(0, level - baseLevel) * upcastCost;
}

function getHighestAffordableSpellLevel(baseLevel, maxLevel, baseCost, upcastCost, currentCharges) {
  const min = Math.max(0, baseLevel);
  const max = Math.max(min, maxLevel);

  for (let lvl = max; lvl >= min; lvl--) {
    if (getSpellCastCost(lvl, baseLevel, baseCost, upcastCost) <= currentCharges) return lvl;
  }

  return null;
}

function promptSpellCastLevel(name, baseLevel, maxLevel, baseCost, upcastCost, currentCharges) {
  const min = Math.max(0, baseLevel);
  const max = Math.max(min, maxLevel);
  if (min === 0) return Promise.resolve(0);

  const options = [];
  let hasAffordable = false;
  for (let lvl = min; lvl <= max; lvl++) {
    const totalCost = getSpellCastCost(lvl, baseLevel, baseCost, upcastCost);
    const disabled = totalCost > currentCharges;
    if (!disabled) hasAffordable = true;
    options.push(`<option value="${lvl}" ${disabled ? "disabled" : ""}>Level ${lvl} &mdash; Cost ${totalCost}</option>`);
  }

  if (!hasAffordable) {
    ui.notifications.warn("Not enough charges to cast this power.");
    return Promise.resolve(null);
  }

  const content = `
    <form class="dft-form">
      <div class="form-group">
        <label>Cast "${name}" at what level?</label>
        <select name="slotLevel">${options.join("")}</select>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: "Upcast",
      content,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Cast",
          callback: (html) => {
            const form = html[0].querySelector("form");
            resolve(Number(form.slotLevel.value));
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-xmark"></i>',
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

function promptBonusCharges(current) {
  const content = `
    <form class="dft-form">
      <div class="form-group">
        <label>Bonus charges (can be negative)</label>
        <input type="number" name="bonus" value="${Number(current ?? 0)}" step="1"/>
      </div>
    </form>
  `;
  return new Promise((resolve) => {
    new Dialog({
      title: "Set Bonus Charges",
      content,
      buttons: {
        ok: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Save",
          callback: (html) => {
            const form = html[0].querySelector("form");
            resolve(Math.floor(Number(form.bonus.value ?? 0)));
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-xmark"></i>',
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

function formatSigned(n) {
  const x = Number(n) || 0;
  return x >= 0 ? `+${x}` : `${x}`;
}

function getWillpowerTotal(actor) {
  const rd = actor?.getRollData?.() ?? {};
  const wp =
    foundry.utils.getProperty(rd, "willpower.total") ??
    foundry.utils.getProperty(actor, "system.willpower.total") ??
    foundry.utils.getProperty(actor, "willpower.total") ??
    0;
  return Number(wp) || 0;
}

function computeCastingStats(actor, castingStat) {
  if (castingStat === "willpower" && actor?.type === "npc") {
    const half = getNpcCrHalfUpMin1(actor);
    const saveDC = 10 + half;
    const attackMod = 2 + half;
    return { saveDC, attackMod, attackModSigned: formatSigned(attackMod) };
  }

  const prof = Number(actor?.system?.attributes?.prof ?? 0) || 0;

  if (castingStat === "willpower") {
    const wp = getWillpowerTotal(actor);
    const halfUp = Math.floor((wp + 1) / 2);
    const saveDC = 10 + halfUp;
    const attackMod = 2 + halfUp;
    return { saveDC, attackMod, attackModSigned: formatSigned(attackMod) };
  }

  const mod = Number(actor?.system?.abilities?.[castingStat]?.mod ?? 0) || 0;
  const saveDC = 10 + prof + mod;
  const attackMod = 2 + prof + mod;
  return { saveDC, attackMod, attackModSigned: formatSigned(attackMod) };
}

function injectRuntimeCssOnce() {
  if (document.getElementById("dft-runtime-style")) return;
  const style = document.createElement("style");
  style.id = "dft-runtime-style";
  style.textContent = `
    .dft-hidden-item { display: none !important; }
    .dft-tab-icon-img { width: 18px; height: 18px; object-fit: contain; vertical-align: middle; }
    .dft-tab-icon-fa { font-size: 18px; line-height: 1; vertical-align: middle; }
    .dft-sr-only {
      position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
      clip:rect(0,0,0,0);white-space:nowrap;border:0;
    }
    .dft-tab-icon-fruit::before {
      content: "";
      display: inline-block;
      width: 1em;
      height: 1em;
      background-image: url("${ICON_FRUIT}");
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      vertical-align: middle;
    }
    .dft-tab-icon-haki::before {
      content: "\\f132";
      display: inline-block;
      font-family: "Font Awesome 6 Free";
      font-weight: 900;
      vertical-align: middle;
    }
  `;
  document.head.appendChild(style);
}

function hideManagedItemsInSheet(sheetRoot, actor) {
  if (!sheetRoot || !actor) return;
  setTimeout(() => {
    const managedIds = (actor?.items?.contents ?? []).filter(isManagedItem).map((i) => i.id);
    if (!managedIds.length) return;

    for (const id of managedIds) {
      sheetRoot.querySelectorAll(`[data-item-id="${id}"]`).forEach((el) => el.classList.add("dft-hidden-item"));
      sheetRoot.querySelectorAll(`[data-document-id="${id}"]`).forEach((el) => el.classList.add("dft-hidden-item"));
      sheetRoot.querySelectorAll(`li[data-item-id="${id}"], li[data-document-id="${id}"]`)
        .forEach((el) => el.classList.add("dft-hidden-item"));
    }
  }, 0);
}

function getActorLevel(actor) {
  const direct = Number(actor.system?.details?.level);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const classes = actor.items?.filter?.((i) => i.type === "class") ?? [];
  const sum = classes.reduce((t, c) => t + Number(c.system?.levels ?? 0), 0);
  return sum > 0 ? sum : 1;
}

function getChargesMaxBase(type, level) {
  const lvl = clamp(Math.floor(level), 1, 20);

  if (type === "logia" || type === "hakiPurist") return LOGIA_MAX[lvl] ?? 0;

  if (type === "zoan" || type === "haki") return 0;

  return PARAMECIA_MAX[lvl] ?? 0;
}

function getChargesCurrentForMode(actor, mode, chargesMax) {
  const stored = actor.getFlag(MODULE_ID, modeFlag(mode, "cur"));
  const cur = Number.isFinite(Number(stored)) ? Number(stored) : chargesMax;
  return clamp(cur, 0, chargesMax);
}

// Keep stored charges valid after type, bonus, or NPC scaling changes alter the maximum.
async function reconcileChargesForMode(actor, mode) {
  const powerType =
    actor.getFlag(MODULE_ID, modeFlag(mode, "type")) ??
    (mode === "haki" ? "haki" : "paramecia");

  const level = getEffectivePowerLevel(actor, mode);
  const bonus = Number(actor.getFlag(MODULE_ID, modeFlag(mode, "bonus")) ?? 0);
  const max = Math.max(0, getChargesMaxBaseForActor(actor, powerType, level) + bonus);
  const cur = getChargesCurrentForMode(actor, mode, max);

  await actor.setFlag(MODULE_ID, modeFlag(mode, "cur"), clamp(cur, 0, max));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rerenderAllActorSheets(actor) {
  try {
    const apps = actor?.apps ? Object.values(actor.apps) : [];
    for (const app of apps) app?.render?.(false);
    actor?.sheet?.render?.(false);
  } catch (err) {
    console.warn(`${MODULE_ID} | rerenderAllActorSheets failed`, err);
  }
}

function getDragEventDataSafe(event) {
  try {
    const v13 = foundry?.applications?.ux?.TextEditor?.getDragEventData;
    if (typeof v13 === "function") return v13(event);
  } catch (_) {}

  try {
    if (globalThis.TextEditor?.getDragEventData) return globalThis.TextEditor.getDragEventData(event);
  } catch (_) {}

  try {
    const raw = event?.dataTransfer?.getData("text/plain");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}
