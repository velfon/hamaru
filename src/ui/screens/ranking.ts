/**
 * ランキング画面(docs/08 §7)。
 *
 * ┌──────────────────────────────┐
 * │ ←  ランキング                 │
 * │ [今日][今週][今月][全期間]    │
 * │ 今日の挑戦の、初回の得点で…   │
 * │ ┌ あなた ─────────────────┐ │
 * │ │ 青磁の陶工 0421  名前を変える│ │
 * │ │ 12 位 / 348 人   4,520 点  │ │
 * │ └──────────────────────────┘ │
 * │  1  柿の窯守 1203     9,870  │
 * │  2  こはる            9,410  │
 * │  …                           │
 * └──────────────────────────────┘
 *
 * 自分の行は /me の順位と一致する行を金継ぎ色で示す(API は ID を返さないので順位で照合する)。
 */
import { formatNumber, t } from "../../i18n";
import { button, iconButton, ICON_BACK } from "../components/button";
import { toast } from "../components/toast";
import { el } from "../dom";
import {
  fetchMe,
  fetchTop,
  formatName,
  PERIODS,
  setNickname,
  type MeJson,
  type NameJson,
  type Period,
  type TopJson,
} from "../leaderboard-api";
import { navigate, type Screen } from "../router";
import { getContext, settingsStore } from "../store";

const TAB_LABEL: Record<Period, string> = {
  daily: "ranking.tab.daily",
  week: "ranking.tab.week",
  month: "ranking.tab.month",
  all: "ranking.tab.all",
};

function isPeriod(v: string | null): v is Period {
  return v !== null && (PERIODS as readonly string[]).includes(v);
}

export function rankingScreen(container: HTMLElement, query: URLSearchParams): Screen {
  const ctx = getContext();
  const joined = settingsStore.get().leaderboard;
  let period: Period = isPeriod(query.get("period")) ? (query.get("period") as Period) : "daily";
  let myName: NameJson | null = null;
  let disposed = false;
  let requestId = 0;

  /* タブ */
  const tabs = el("div", { class: "tabs", role: "tablist", "aria-label": t("ranking.title") });
  const tabButtons = new Map<Period, HTMLButtonElement>();
  for (const p of PERIODS) {
    const b = el(
      "button",
      {
        class: "tabs__tab",
        role: "tab",
        type: "button",
        "data-testid": `tab-${p}`,
      },
      [t(TAB_LABEL[p])],
    );
    b.addEventListener("click", () => {
      if (p === period) return;
      period = p;
      history.replaceState(null, "", `#/ranking?period=${p}`);
      void load();
    });
    tabButtons.set(p, b);
    tabs.appendChild(b);
  }

  const note = el("p", { class: "ranking__note" });
  const meCard = el("section", { class: "card ranking__me", "data-testid": "ranking-me" });
  const list = el("div", { class: "ranking__list", "data-testid": "ranking-list" });

  const screen = el("div", { class: "screen", "data-testid": "ranking-screen" }, [
    el("div", { class: "topbar" }, [
      iconButton({
        label: t("ranking.back"),
        paths: ICON_BACK,
        testId: "back",
        onClick: () => navigate("/"),
      }),
      el("h1", { class: "topbar__title topbar__title--sub" }, [t("ranking.title")]),
      el("div", { class: "topbar__spacer" }),
    ]),
    tabs,
    note,
    meCard,
    list,
  ]);
  container.appendChild(screen);

  /* 自分のカード */
  function renderMe(me: MeJson | null): void {
    if (!joined) {
      meCard.replaceChildren(el("p", { class: "muted" }, [t("ranking.notJoined")]));
      return;
    }
    const nameText = myName === null ? "…" : formatName(myName);
    const rename = button({
      label: t("ranking.rename"),
      variant: "ghost",
      testId: "rename",
      onClick: () => void openNameDialog(),
    });
    const standing =
      me === null || me.rank === null
        ? el("span", { class: "muted", "data-testid": "my-rank" }, [t("ranking.noRecord")])
        : el("span", { class: "ranking__myrank", "data-testid": "my-rank" }, [
            t("ranking.myRank", { rank: formatNumber(me.rank), count: formatNumber(me.count) }),
            me.attempts === undefined ? "" : ` · ${t("ranking.attempts", { n: me.attempts })}`,
          ]);
    meCard.replaceChildren(
      el("div", { class: "ranking__mehead" }, [
        el("div", {}, [
          el("span", { class: "ranking__melabel" }, [t("ranking.me")]),
          el("b", { class: "ranking__myname", "data-testid": "my-name" }, [nameText]),
        ]),
        rename,
      ]),
      el("div", { class: "ranking__mestats" }, [
        standing,
        me !== null && me.score !== null
          ? el("span", { class: "ranking__score" }, [formatNumber(me.score)])
          : null,
      ]),
    );
  }

  /* 一覧 */
  function renderList(top: TopJson, myRank: number | null): void {
    if (top.top.length === 0) {
      list.replaceChildren(
        el("p", { class: "ranking__empty", "data-testid": "ranking-empty" }, [t("ranking.empty")]),
      );
      return;
    }
    const ol = el("ol", { class: "ranking__rows" });
    for (const row of top.top) {
      const isMe = myRank !== null && row.rank === myRank;
      ol.appendChild(
        el(
          "li",
          {
            class: isMe ? "ranking__row ranking__row--me" : "ranking__row",
            "data-testid": isMe ? "ranking-row-me" : "ranking-row",
            ...(isMe ? { "aria-current": "true" } : {}),
          },
          [
            el("span", { class: "ranking__rank" }, [String(row.rank)]),
            el("span", { class: "ranking__name" }, [formatName(row.name)]),
            row.days !== undefined
              ? el("span", { class: "ranking__days" }, [t("ranking.days", { n: row.days })])
              : null,
            // デイリーは「その日のベスト」。何回挑戦したかも見せる(docs/08 §1)。
            row.attempts !== undefined
              ? el("span", { class: "ranking__days" }, [t("ranking.attempts", { n: row.attempts })])
              : null,
            el("span", { class: "ranking__score" }, [formatNumber(row.score)]),
          ],
        ),
      );
    }
    list.replaceChildren(ol);
  }

  function renderStatus(key: "ranking.loading" | "ranking.error"): void {
    const children: Array<Node | string> = [el("p", { class: "muted" }, [t(key)])];
    if (key === "ranking.error") {
      children.push(
        button({
          label: t("ranking.retry"),
          variant: "secondary",
          testId: "ranking-retry",
          onClick: () => void load(),
        }),
      );
    }
    list.replaceChildren(
      el(
        "div",
        {
          class: "ranking__status",
          "data-testid": key === "ranking.error" ? "ranking-error" : "ranking-loading",
        },
        children,
      ),
    );
  }

  async function load(): Promise<void> {
    const id = ++requestId;
    for (const [p, b] of tabButtons) {
      b.setAttribute("aria-selected", String(p === period));
      b.tabIndex = p === period ? 0 : -1;
    }
    note.textContent = t(period === "daily" ? "ranking.note.daily" : "ranking.note.total");
    renderStatus("ranking.loading");
    const [top, me] = await Promise.all([
      fetchTop(period),
      joined ? fetchMe(ctx.installId, period) : Promise.resolve(null),
    ]);
    if (disposed || id !== requestId) return;
    const meData = me !== null && me.ok ? me.data : null;
    if (meData !== null) myName = meData.name;
    renderMe(meData);
    if (!top.ok) {
      renderStatus("ranking.error");
      return;
    }
    renderList(top.data, meData?.rank ?? null);
  }

  /* 名前の変更 */
  async function openNameDialog(): Promise<void> {
    const current = myName !== null && "nickname" in myName ? myName.nickname : "";
    const input = el("input", {
      type: "text",
      class: "dialog__input",
      maxlength: "24",
      autocomplete: "off",
      "aria-label": t("name.dialog.title"),
      "data-testid": "name-input",
    });
    input.value = current;
    const error = el("p", { class: "dialog__error", role: "alert", "data-testid": "name-error" });
    const dialog = el("dialog", { class: "dialog", "data-testid": "name-dialog" }, [
      el("div", { class: "dialog__title" }, [t("name.dialog.title")]),
      el("div", { class: "dialog__body" }, [t("name.dialog.hint")]),
      input,
      error,
    ]);
    const close = (): void => {
      dialog.close();
      dialog.remove();
    };
    const save = async (): Promise<void> => {
      const value = input.value.trim();
      const r = await setNickname(ctx.installId, value === "" ? null : value);
      if (!r.ok) {
        error.textContent = t(
          r.reason === "invalid"
            ? "name.error.invalid"
            : r.reason === "banned"
              ? "name.error.banned"
              : r.reason === "cooldown"
                ? "name.error.cooldown"
                : "name.error.network",
        );
        return;
      }
      myName = r.data.name;
      close();
      toast(t("toast.nameSaved"));
      void load();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") void save();
    });
    dialog.append(
      el("div", { class: "dialog__actions" }, [
        button({
          label: t("name.dialog.save"),
          variant: "primary",
          testId: "name-save",
          onClick: () => void save(),
        }),
        button({
          label: t("name.dialog.cancel"),
          variant: "secondary",
          testId: "name-cancel",
          onClick: close,
        }),
      ]),
    );
    dialog.addEventListener("cancel", close);
    document.body.appendChild(dialog);
    dialog.showModal();
    input.focus();
  }

  renderMe(null);
  void load();

  return {
    unmount() {
      disposed = true;
      document.querySelector('[data-testid="name-dialog"]')?.remove();
    },
  };
}
