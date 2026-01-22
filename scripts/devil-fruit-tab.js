const MODULE_ID = "devil-fruit-tab";
const TAB_ID = "devil-fruit";
const TEMPLATE_PATH = `/modules/${MODULE_ID}/templates/devil-fruit-tab.hbs`;
const ICON_PATH = `/modules/${MODULE_ID}/assets/apple.webp`;

const PARAMECIA_MAX = [0, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const LOGIA_MAX     = [0, 2, 2, 3, 3, 4, 4, 5, 6, 7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

Hooks.once("init", async () => {
  await loadTemplates([TEMPLATE_PATH]);
  if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);
  injectRuntimeCssOnce();
});

Hooks.on("dnd5e.restCompleted", async (actor, data) => {
  if (!actor) return;
  const isLong = data?.restType === "long" || data?.longRest === true || data?.long === true;
  if (isLong) await refillCharges(actor);
});
Hooks.on("dnd5e.longRest", async (actor) => {
  if (actor) await refillCharges(actor);
});

Hooks.once("tidy5e-sheet.ready", (api) => {
  try {
    const HandlebarsTab = api?.models?.HandlebarsTab;
    if (!HandlebarsTab) return;

    const makeTab = () => new HandlebarsTab({
      title: "Devil Fruit",
      tabId: TAB_ID,
      iconClass: "dft-tab-icon",
      path: TEMPLATE_PATH,
      getData: async (context) => {
        const actor = context?.actor ?? context?.document ?? context?.app?.document;
        return buildTemplateData(actor);
      },
      onRender: (params) => {
        const rootEl = params?.tabContentsElement ?? params?.element;
        const actor = params?.app?.document ?? params?.app?.actor ?? params?.actor;
        wireTabInteractions(rootEl, actor);

        const sheetRoot = params?.app?.element?.[0] ?? params?.app?.element ?? document;
        hideDfItemsInSheet(sheetRoot, actor);
      }
    });

    api?.registerCharacterTab?.(makeTab());
    api?.registerNpcTab?.(makeTab());
    api?.registerVehicleTab?.(makeTab());
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to register Tidy tab`, err);
  }
});

Hooks.on("renderActorSheetV2", async (sheet, element) => {
  try {
    const actor = sheet?.actor ?? sheet?.document;
    if (!actor || !["character", "npc", "vehicle"].includes(actor.type)) return;

    // tidy handled above, but still hide DF items
    if (element?.classList?.contains("tidy5e-sheet")) {
      hideDfItemsInSheet(element, actor);
      return;
    }

    await injectCoreTab(sheet, element, actor);
    hideDfItemsInSheet(element, actor);
  } catch (err) {
    console.error(`${MODULE_ID} | renderActorSheetV2 error`, err);
  }
});

async function injectCoreTab(sheet, element, actor) {
  const nav =
    element.querySelector('nav.tabs[data-group]') ||
    element.querySelector('nav.sheet-tabs[data-group]') ||
    element.querySelector("nav.tabs") ||
    element.querySelector("nav.sheet-tabs") ||
    element.querySelector("nav[data-group]");
  if (!nav) return;

  const group = nav.dataset.group ?? "primary";

  const panel = findOrCreateCorePanel(element, group);
  await renderTabContents(panel, actor);
  wireTabInteractions(panel, actor);

  if (nav.querySelector(`[data-tab="${TAB_ID}"][data-group="${group}"]`)) return;

  const sample = nav.querySelector(":scope > *");
  const tabEl = document.createElement("button");
  if (sample?.className) tabEl.className = sample.className;
  tabEl.classList.add("item");
  tabEl.type = "button";
  tabEl.dataset.tab = TAB_ID;
  tabEl.dataset.group = group;
  tabEl.dataset.action = "tab";
  tabEl.title = "Devil Fruit";

  tabEl.innerHTML = `
    <img class="dft-tab-icon-img" src="${ICON_PATH}" alt="" />
    <span class="dft-sr-only">Devil Fruit</span>
  `;

  nav.appendChild(tabEl);

  if (!tabEl.dataset.dftBound) {
    tabEl.dataset.dftBound = "1";
    tabEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      if (typeof sheet.changeTab === "function") {
        sheet.changeTab(TAB_ID, group);
        return;
      }

      nav.querySelectorAll(`.item[data-group="${group}"]`).forEach((n) => {
        n.classList.toggle("active", n === tabEl);
        n.setAttribute("aria-selected", n === tabEl ? "true" : "false");
      });

      const contentRoot = panel.parentElement ?? element;
      contentRoot.querySelectorAll(`.tab[data-group="${group}"]`).forEach((p) => {
        const isActive = p.dataset.tab === TAB_ID;
        p.classList.toggle("active", isActive);
        p.style.display = isActive ? "" : "none";
      });
    });
  }
}

function findOrCreateCorePanel(element, group) {
  const existingPanel = element.querySelector(`.tab[data-group="${group}"]`);
  const contentRoot =
    existingPanel?.parentElement ||
    element.querySelector(".sheet-body") ||
    element.querySelector("section.sheet-body") ||
    element.querySelector(".window-content") ||
    element;

  let panel = contentRoot.querySelector(`.tab[data-tab="${TAB_ID}"][data-group="${group}"]`);
  if (!panel) {
    panel = document.createElement("section");
    panel.classList.add("tab");
    panel.dataset.tab = TAB_ID;
    panel.dataset.group = group;
    contentRoot.appendChild(panel);
  }
  return panel;
}

async function renderTabContents(panelEl, actor) {
  if (!panelEl || !actor) return;
  const data = buildTemplateData(actor);
  panelEl.innerHTML = await renderTemplate(TEMPLATE_PATH, data);
}

function isDfItem(item) {
  return Boolean(item?.getFlag?.(MODULE_ID, "dfManaged") || item?.getFlag?.(MODULE_ID, "devilFruit"));
}
function getDfItems(actor) {
  return (actor?.items?.contents ?? []).filter(isDfItem);
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
  // 26-30 (and anything above) => 24
  return 24;
}

function getChargesMaxBaseForActor(actor, type, level) {
  // NPCs use CR table for charges (except Zoan still base 0)
  if (actor?.type === "npc") {
    if (type === "zoan") return 0;
    return getNpcDevilFruitChargesByCR(actor);
  }
  return getChargesMaxBase(type, level);
}

function buildTemplateData(actor) {
  const fruitType = (actor.getFlag(MODULE_ID, "fruitType") ?? "paramecia");
  const fruitName = (actor.getFlag(MODULE_ID, "fruitName") ?? "Devil Fruit");
  const fruitImg = (actor.getFlag(MODULE_ID, "fruitImg") ?? null);
  const bonusCharges = Number(actor.getFlag(MODULE_ID, "bonusCharges") ?? 0);

  const castingStat = (actor.getFlag(MODULE_ID, "castingStat") ?? "cha");
  const { saveDC: fruitSaveDC, attackModSigned: fruitAttackModSigned } =
    computeFruitCastingStats(actor, castingStat);

  const level = getActorLevel(actor);
  const highestSpellLevel = getHighestSpellLevel(level);

  const chargesMaxBase = getChargesMaxBaseForActor(actor, fruitType, level);

  const chargesMax = Math.max(0, chargesMaxBase + bonusCharges);

  const showCharges = true;

  const storedCurrent = actor.getFlag(MODULE_ID, "chargesCurrent");
  const chargesCurrentRaw = Number.isFinite(Number(storedCurrent)) ? Number(storedCurrent) : chargesMax;
  const chargesCurrent = clamp(chargesCurrentRaw, 0, chargesMax);
  const chargePct = showCharges && chargesMax > 0 ? (chargesCurrent / chargesMax) * 100 : 0;

  const df = getDfItems(actor).map((i) => ({
    uuid: i.uuid,
    id: i.id,
    name: i.name,
    img: i.img,
    type: i.type,
    chargeCost: Number(i.getFlag(MODULE_ID, "chargeCost") ?? 0),
    allowUpcast: Boolean(i.getFlag(MODULE_ID, "allowUpcast")),
    upcastCost: Number(i.getFlag(MODULE_ID, "upcastCost") ?? 0),
    spellLevel: Number(i.system?.level ?? i.system?.spellLevel ?? 0)
  }));

  const spells = df.filter((i) => i.type === "spell");
  const attacks = df.filter((i) => i.type === "weapon");
  const features = df.filter((i) => i.type === "feat");
  const other = df.filter((i) => !["spell", "weapon", "feat"].includes(i.type));

  return {
    fruitType,
    fruitName,
    fruitImg,

    castingStat,
    fruitSaveDC,
    fruitAttackModSigned,
    highestSpellLevel,

    showCharges,
    chargesCurrent,
    chargesMax,
    chargePct: Math.round(chargePct),
    bonusCharges,

    spells,
    attacks,
    features,
    other,
    hasAny: df.length > 0
  };
}

function wireTabInteractions(rootEl, actor) {
  if (!rootEl || !actor) return;

  // One-time auto-sync DF items to current dropdown on first render
  if (!rootEl.dataset.dftAutosynced) {
    rootEl.dataset.dftAutosynced = "1";
    queueMicrotask(async () => {
      try {
        const desired = actor.getFlag(MODULE_ID, "castingStat") ?? "cha";
        const last = actor.getFlag(MODULE_ID, "lastAppliedCastingStat") ?? null;
        if (last !== desired) {
          await applyDfStatToAllDfItems(actor, desired);
          await actor.setFlag(MODULE_ID, "lastAppliedCastingStat", desired);
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
      const nextType = ev.target?.value ?? "paramecia";
      await actor.setFlag(MODULE_ID, "fruitType", nextType);

      const level = getActorLevel(actor);
      const bonus = Number(actor.getFlag(MODULE_ID, "bonusCharges") ?? 0);
      const max = Math.max(0, getChargesMaxBaseForActor(actor, nextType, level) + bonus);
      const cur = getChargesCurrent(actor, max);
      await actor.setFlag(MODULE_ID, "chargesCurrent", clamp(cur, 0, max));

      rerenderAllActorSheets(actor);
    });
  }

  const statSelect = rootEl.querySelector('[data-action="set-casting-stat"]');
  if (statSelect && !statSelect.dataset.dftWired) {
    statSelect.dataset.dftWired = "1";
    statSelect.addEventListener("change", async (ev) => {
      const next = ev.target?.value ?? "cha";
      await actor.setFlag(MODULE_ID, "castingStat", next);

      await applyDfStatToAllDfItems(actor, next);
      await actor.setFlag(MODULE_ID, "lastAppliedCastingStat", next);

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
      await adjustCharges(actor, +1);
    });
  }
  if (minusBtn && !minusBtn.dataset.dftWired) {
    minusBtn.dataset.dftWired = "1";
    minusBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await adjustCharges(actor, -1);
    });
  }
  if (bonusBtn && !bonusBtn.dataset.dftWired) {
    bonusBtn.dataset.dftWired = "1";
    bonusBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const current = Number(actor.getFlag(MODULE_ID, "bonusCharges") ?? 0);
      const next = await promptBonusCharges(current);
      if (next === null) return;

      await actor.setFlag(MODULE_ID, "bonusCharges", next);

      const type = actor.getFlag(MODULE_ID, "fruitType") ?? "paramecia";
      const level = getActorLevel(actor);

      const prevMax = Math.max(0, getChargesMaxBaseForActor(actor, type, level) + Number(current));
      const nextMax = Math.max(0, getChargesMaxBaseForActor(actor, type, level) + Number(next));

      let cur = getChargesCurrent(actor, nextMax);

      // Zoan: if it went from 0 max to >0 max, fill it.
      if (type === "zoan" && prevMax <= 0 && nextMax > 0) cur = nextMax;

      await actor.setFlag(MODULE_ID, "chargesCurrent", clamp(cur, 0, nextMax));
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
          upcastCost: Number(item.getFlag(MODULE_ID, "upcastCost") ?? 0)
        };
        const updated = await promptItemChargeConfig(item, actor, current);
        if (!updated) return;

        await item.setFlag(MODULE_ID, "chargeCost", updated.chargeCost);
        await item.setFlag(MODULE_ID, "allowUpcast", updated.allowUpcast);
        await item.setFlag(MODULE_ID, "upcastCost", updated.upcastCost);

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
        await useDevilFruitItem(actor, item);
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

      const mode = dropTarget.dataset.dftDrop;
      if (mode === "fruit") return handleFruitDrop(ev, actor);
      if (mode === "items") return handleItemDrop(ev, actor);
    }, { capture: true });
  }
}

async function handleFruitDrop(event, actor) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can set the Devil Fruit image/name.");
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

  await actor.setFlag(MODULE_ID, "fruitImg", src);
  await actor.setFlag(MODULE_ID, "fruitName", doc.name ?? "Devil Fruit");
  rerenderAllActorSheets(actor);
}

async function handleItemDrop(event, actor) {
  const data = getDragEventDataSafe(event);
  if (!data || data.type !== "Item") return;

  const uuid = data.uuid ?? (data.pack && data.id ? `Compendium.${data.pack}.Item.${data.id}` : null);
  if (!uuid) return;

  const dropped = await fromUuid(uuid).catch(() => null);
  if (!dropped || dropped.documentName !== "Item") return;

  if (dropped.parent?.uuid === actor.uuid && isDfItem(dropped)) return;

  const createData = dropped.toObject();
  delete createData._id;

  createData.flags ??= {};
  createData.flags[MODULE_ID] = {
    ...(createData.flags[MODULE_ID] ?? {}),
    dfManaged: true,
    devilFruit: true,
    dfSourceUuid: dropped.uuid
  };

  createData.flags.core ??= {};
  createData.flags.core.sourceId = dropped.uuid;

  const [created] = await actor.createEmbeddedDocuments("Item", [createData]);

  const fruitType = actor.getFlag(MODULE_ID, "fruitType") ?? "paramecia";
  if (fruitType !== "zoan") {
    const cfg = await promptItemChargeConfig(created, actor, null);
    if (cfg) {
      await created.setFlag(MODULE_ID, "chargeCost", cfg.chargeCost);
      await created.setFlag(MODULE_ID, "allowUpcast", cfg.allowUpcast);
      await created.setFlag(MODULE_ID, "upcastCost", cfg.upcastCost);
    }
  } else {
    await created.setFlag(MODULE_ID, "chargeCost", 0);
    await created.setFlag(MODULE_ID, "allowUpcast", false);
    await created.setFlag(MODULE_ID, "upcastCost", 0);
  }

  const castingStat = actor.getFlag(MODULE_ID, "castingStat") ?? "cha";
  await applyDfStatToItemActivities(created, castingStat, actor);
  await actor.setFlag(MODULE_ID, "lastAppliedCastingStat", castingStat);

  rerenderAllActorSheets(actor);
  if (game.user.isGM) created.sheet?.render(true);
}

async function useDevilFruitItem(actor, item) {
  const fruitType = actor.getFlag(MODULE_ID, "fruitType") ?? "paramecia";

  const levelForMax = getActorLevel(actor);
  const bonusForMax = Number(actor.getFlag(MODULE_ID, "bonusCharges") ?? 0);
  const maxForMax = Math.max(0, getChargesMaxBaseForActor(actor, fruitType, levelForMax) + bonusForMax);
  const showCharges = maxForMax > 0;

  let slotLevel = null;
  let totalCost = Number(item.getFlag(MODULE_ID, "chargeCost") ?? 0);

  if (showCharges) {
    const level = getActorLevel(actor);
    const highestSpellLevel = getHighestSpellLevel(level);

    if (item.type === "spell") {
      const baseSpellLevel = Number(item.system?.level ?? item.system?.spellLevel ?? 0);
      const allowUpcast = Boolean(item.getFlag(MODULE_ID, "allowUpcast"));
      const upcastCost = Number(item.getFlag(MODULE_ID, "upcastCost") ?? 0);

      if (allowUpcast) {
        const chosen = await promptSpellCastLevel(item.name, baseSpellLevel, highestSpellLevel);
        if (chosen === null) return;
        slotLevel = chosen;
        totalCost = totalCost + Math.max(0, (slotLevel - baseSpellLevel)) * upcastCost;
      } else {
        slotLevel = baseSpellLevel;
      }
    }

    const max = maxForMax;
    const cur = getChargesCurrent(actor, max);

    if (totalCost > cur) {
      ui.notifications.warn(`Not enough Devil Fruit charges. Need ${totalCost}, have ${cur}.`);
      return;
    }

    await actor.setFlag(MODULE_ID, "chargesCurrent", clamp(cur - totalCost, 0, max));
    rerenderAllActorSheets(actor);
  }

  try {
    const opts = { configureDialog: true, consumeSpellSlot: false, consumeSlot: false };
    if (slotLevel !== null) opts.slotLevel = slotLevel;
    await item.use(opts);
  } catch (e) {
    console.warn(`${MODULE_ID} | item.use failed, opening sheet instead`, e);
    item.sheet?.render(true);
  }
}

async function adjustCharges(actor, delta) {
  const fruitType = actor.getFlag(MODULE_ID, "fruitType") ?? "paramecia";

  const level = getActorLevel(actor);
  const bonus = Number(actor.getFlag(MODULE_ID, "bonusCharges") ?? 0);
  const max = Math.max(0, getChargesMaxBaseForActor(actor, fruitType, level) + bonus);

  if (max <= 0) return;

  const cur = getChargesCurrent(actor, max);

  await actor.setFlag(MODULE_ID, "chargesCurrent", clamp(cur + delta, 0, max));
  rerenderAllActorSheets(actor);
}

async function refillCharges(actor) {
  const fruitType = actor.getFlag(MODULE_ID, "fruitType") ?? "paramecia";

  const level = getActorLevel(actor);
  const bonus = Number(actor.getFlag(MODULE_ID, "bonusCharges") ?? 0);
  const max = Math.max(0, getChargesMaxBaseForActor(actor, fruitType, level) + bonus);

  if (max <= 0) return;

  await actor.setFlag(MODULE_ID, "chargesCurrent", max);
  rerenderAllActorSheets(actor);
}

function halfUpFormula(varPath) {
  // avoids ceil() just in case; "half rounded up"
  return `floor((${varPath} + 1) / 2)`;
}

function getDfFormulasForStat(stat, actor) {
  if (stat === "willpower") {
    // ✅ NPC willpower uses CR/2 up min 1 (baked as constants for reliability)
    if (actor?.type === "npc") {
      const half = getNpcCrHalfUpMin1(actor);
      return {
        dcFormula: `10 + ${half}`,
        atkFormula: `8 + ${half}`
      };
    }

    // default willpower formula (characters/vehicles)
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

async function applyDfStatToItemActivities(item, castingStat, actor) {
  const { dcFormula, atkFormula } = getDfFormulasForStat(castingStat, actor);
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
    console.warn(`${MODULE_ID} | Failed to apply DF formulas to ${item.name}`, e, update);
  }
}

async function applyDfStatToAllDfItems(actor, castingStat) {
  const df = getDfItems(actor);
  for (const item of df) {
    await applyDfStatToItemActivities(item, castingStat, actor);
  }
}

function promptItemChargeConfig(item, actor, existing) {
  const fruitType = actor.getFlag(MODULE_ID, "fruitType") ?? "paramecia";
  const isSpell = item.type === "spell";

  const chargeCost = existing ? Number(existing.chargeCost ?? 0) : 1;
  const allowUpcast = existing ? Boolean(existing.allowUpcast) : false;
  const upcastCost = existing ? Number(existing.upcastCost ?? 0) : 1;

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
      ` : ``}

      ${fruitType === "zoan" ? `<p><em>Note: Zoan fruits don’t use charges (cost will be ignored).</em></p>` : ``}
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: `Devil Fruit Cost: ${item.name}`,
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
            resolve({
              chargeCost: Math.max(0, Math.floor(cc)),
              allowUpcast: au,
              upcastCost: Math.max(0, Math.floor(uc))
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

function promptSpellCastLevel(name, baseLevel, maxLevel) {
  const min = Math.max(0, baseLevel);
  const max = Math.max(min, maxLevel);
  if (min === 0) return Promise.resolve(0);

  const options = [];
  for (let lvl = min; lvl <= max; lvl++) options.push(`<option value="${lvl}">Level ${lvl}</option>`);

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
      title: "Devil Fruit Upcast",
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

function computeFruitCastingStats(actor, castingStat) {
  // ✅ NPC willpower uses CR/2 up min 1, ignoring prof/ability
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
    .dft-sr-only {
      position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
      clip:rect(0,0,0,0);white-space:nowrap;border:0;
    }
    .dft-tab-icon::before {
      content: "";
      display: inline-block;
      width: 1em;
      height: 1em;
      background-image: url("${ICON_PATH}");
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      vertical-align: middle;
    }
  `;
  document.head.appendChild(style);
}

function hideDfItemsInSheet(sheetRoot, actor) {
  if (!sheetRoot || !actor) return;
  setTimeout(() => {
    const managedIds = getDfItems(actor).map((i) => i.id);
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

function getHighestSpellLevel(level) {
  return Math.min(9, Math.floor((level + 1) / 2));
}

function getChargesMaxBase(type, level) {
  const lvl = clamp(Math.floor(level), 1, 20);
  if (type === "logia") return LOGIA_MAX[lvl] ?? 0;
  if (type === "zoan") return 0;
  return PARAMECIA_MAX[lvl] ?? 0;
}

function getChargesCurrent(actor, chargesMax) {
  const stored = actor.getFlag(MODULE_ID, "chargesCurrent");
  const cur = Number.isFinite(Number(stored)) ? Number(stored) : chargesMax;
  return clamp(cur, 0, chargesMax);
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

