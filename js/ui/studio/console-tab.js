// Console tab: logs and errors from the preview, with "Ask the agent to fix".
import { h, fmtDate } from "../dom.js";

export function consoleTab(panel, ws) {
  const list = h("div", { class: "cs-list", role: "log" });
  const fixBtn = h(
    "button",
    {
      class: "btn btn-sm btn-primary",
      type: "button",
      onclick: () => {
        ws.show("chat");
        ws.agentSend && ws.agentSend(`Fix these errors:\n${[...new Set(ws.errors())].slice(-5).join("\n")}`);
      },
    },
    "Ask the agent to fix errors",
  );
  const render = () => {
    fixBtn.hidden = !ws.errors().length;
    list.replaceChildren(
      ...(ws.logs.length
        ? ws.logs.slice(-300).map((l) => h("div", { class: "cs-line cs-" + l.level, title: fmtDate(l.at) }, h("span", { class: "cs-level" }, l.level), l.text))
        : [h("p", { class: "note" }, "Messages and errors from the preview show up here.")]),
    );
    list.scrollTop = list.scrollHeight;
  };
  panel.replaceChildren(
    h(
      "div",
      { class: "cs" },
      h(
        "div",
        { class: "pv-toolbar" },
        fixBtn,
        h("span", { class: "spacer" }),
        h(
          "button",
          {
            class: "btn btn-sm",
            type: "button",
            onclick: () => {
              ws.logs.length = 0;
              render();
              ws.refresh();
            },
          },
          "Clear",
        ),
      ),
      list,
    ),
  );
  ws.onRefresh(render);
  render();
}
