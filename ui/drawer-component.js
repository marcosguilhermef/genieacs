"use strict";

import m from "mithril";

import * as taskQueue from "./task-queue";
import * as store from "./store";
import * as notifications from "./notifications";

function mparam(param) {
  return m("span.parameter", { title: param }, `${param}`);
}

function mval(val) {
  return m("span.value", { title: val }, `${val}`);
}

function renderStagingSpv(task, queueFunc, cancelFunc) {
  function keydown(e) {
    if (e.keyCode === 13) queueFunc();
    else if (e.keyCode === 27) cancelFunc();
    else e.redraw = false;
  }

  let input;
  if (task.parameterValues[0][2] === "xsd:boolean") {
    input = m(
      "select",
      {
        value: task.parameterValues[0][1].toString(),
        onchange: e => {
          e.redraw = false;
          task.parameterValues[0][1] = input.dom.value;
        },
        onkeydown: keydown,
        oncreate: vnode => {
          vnode.dom.focus();
        }
      },
      [
        m("option", { value: "true" }, "true"),
        m("option", { value: "false" }, "false")
      ]
    );
  } else {
    input = m("input", {
      type: ["xsd:dateTime", "xsd:int", "xsd:unsignedInt"].includes(
        task.parameterValues[0][2]
      )
        ? "number"
        : "text",
      value: task.parameterValues[0][1],
      oninput: e => {
        e.redraw = false;
        task.parameterValues[0][1] = input.dom.value;
      },
      onkeydown: keydown,
      oncreate: vnode => {
        vnode.dom.focus();
        vnode.dom.select();
        // Need to prevent scrolling on focus because
        // we're animating height and using overflow: hidden
        vnode.dom.parentNode.parentNode.scrollTop = 0;
      }
    });
  }

  return [m("span", "Editing ", mparam(task.parameterValues[0][0])), input];
}

function renderStagingDownload(task) {
  task.invalid = !task.fileName || !task.fileType;
  const files = store.fetch("files", true);
  const idParts = task.device.split("-");
  const oui = decodeURIComponent(idParts[0]);
  const productClass =
    idParts.length === 3 ? decodeURIComponent(idParts[1]) : "";

  const typesList = [
    "",
    "1 Firmware Upgrade Image",
    "2 Web Content",
    "3 Vendor Configuration File",
    "4 Tone File",
    "5 Ringer File"
  ].map(t =>
    m(
      "option",
      {
        disabled: !t,
        value: t,
        selected: (task.fileType || "") === t,
        onclick: () => {
          task.fileType = t;
        }
      },
      t
    )
  );

  const filesList = [""]
    .concat(
      files.value
        .filter(
          f =>
            (!f["metadata.oui"] || f["metadata.oui"] === oui) &&
            (!f["metadata.productClass"] ||
              f["metadata.productClass"] === productClass)
        )
        .map(f => f._id)
    )
    .map(f =>
      m(
        "option",
        {
          disabled: !f,
          value: f,
          selected: (task.fileName || "") === f,
          onclick: () => {
            task.fileName = f;
            task.fileType = "";
            for (const file of files.value)
              if (file._id === f) task.fileType = file["metadata.fileType"];
          }
        },
        f
      )
    );

  return [
    "Push ",
    m(
      "select",
      { disabled: files.fulfilling, style: "width: 350px" },
      filesList
    ),
    " as ",
    m("select", typesList)
  ];
}

function renderStaging(staging) {
  const elements = [];
  for (const s of staging) {
    const queueFunc = () => {
      staging.delete(s);
      taskQueue.queueTask(s);
    };
    const cancelFunc = () => {
      staging.delete(s);
    };

    let elms;
    if (s.name === "setParameterValues")
      elms = renderStagingSpv(s, queueFunc, cancelFunc);
    else if (s.name === "download")
      elms = renderStagingDownload(s, queueFunc, cancelFunc);

    const queue = m(
      "button.primary",
      { title: "Queue task", onclick: queueFunc, disabled: s.invalid },
      "Queue"
    );
    const cancel = m(
      "button",
      { title: "Cancel edit", onclick: cancelFunc },
      "Cancel"
    );

    elements.push(m(".staging", elms, m("div.actions", queue, cancel)));
  }
  return elements;
}

function renderQueue(queue) {
  const details = [];
  const devices = {};
  for (const t of queue) {
    devices[t.device] = devices[t.device] || [];
    devices[t.device].push(t);
  }

  for (const [k, v] of Object.entries(devices)) {
    details.push(m("strong", k));
    for (const t of v) {
      const actions = [];

      if (t.status === "fault" || t.status === "stale") {
        actions.push(
          m(
            "button",
            {
              title: "Retry this task",
              onclick: () => {
                taskQueue.queueTask(t);
              }
            },
            "↺"
          )
        );
      }

      actions.push(
        m(
          "button",
          {
            title: "Remove this task",
            onclick: () => {
              taskQueue.deleteTask(t);
            }
          },
          "✕"
        )
      );

      if (t.name === "setParameterValues") {
        details.push(
          m(
            `div.${t.status}`,
            m(
              "span",
              "Set ",
              mparam(t.parameterValues[0][0]),
              " to '",
              mval(t.parameterValues[0][1]),
              "'"
            ),
            m(".actions", actions)
          )
        );
      } else if (t.name === "refreshObject") {
        details.push(
          m(
            `div.${t.status}`,
            m("span", "Refresh ", mparam(t.parameterName)),
            m(".actions", actions)
          )
        );
      } else if (t.name === "reboot") {
        details.push(m(`div.${t.status}`, "Reboot", m(".actions", actions)));
      } else if (t.name === "factoryReset") {
        details.push(
          m(`div.${t.status}`, "Factory reset", m(".actions", actions))
        );
      } else if (t.name === "addObject") {
        details.push(
          m(
            `div.${t.status}`,
            m("span", "Add ", mparam(t.objectName)),
            m(".actions", actions)
          )
        );
      } else if (t.name === "deleteObject") {
        details.push(
          m(
            `div.${t.status}`,
            m("span", "Delete ", mparam(t.objectName)),
            m(".actions", actions)
          )
        );
      } else if (t.name === "getParameterValues") {
        details.push(
          m(
            `div.${t.status}`,
            `Refresh ${t.parameterNames.length} parameters`,
            m(".actions", actions)
          )
        );
      } else if (t.name === "download") {
        details.push(
          m(
            `div.${t.status}`,
            `Push file: ${t.fileName} (${t.fileType})`,
            m(".actions", actions)
          )
        );
      } else {
        details.push(m(`div.${t.status}`, t.name, m(".actions", actions)));
      }
    }
  }

  return details;
}

function renderNotifications(notifs) {
  const notificationElements = [];

  for (const n of notifs) {
    notificationElements.push(
      m(
        "div.notification",
        {
          class: n.type,
          style: "position: absolute;opacity: 0",
          oncreate: vnode => {
            vnode.dom.style.opacity = 1;
          },
          onbeforeremove: vnode => {
            vnode.dom.style.opacity = 0;
            return new Promise(resolve => {
              setTimeout(() => {
                resolve();
              }, 500);
            });
          },
          key: n.timestamp
        },
        n.message
      )
    );
  }
  return notificationElements;
}

export default function component() {
  return {
    view: vnode => {
      const queue = taskQueue.getQueue();
      const staging = taskQueue.getStaging();
      const notifs = notifications.getNotifications();

      let drawerElement, statusElement;
      const notificationElements = renderNotifications(notifs);
      const stagingElements = renderStaging(staging);
      const queueElements = renderQueue(queue);

      function repositionNotifications() {
        let top = 10;
        for (const c of notificationElements) {
          c.dom.style.top = top;
          top += c.dom.offsetHeight + 10;
        }
      }

      function resizeDrawer() {
        let height =
          statusElement.dom.offsetTop + statusElement.dom.offsetHeight;
        if (stagingElements.length) {
          for (const s of stagingElements)
            height = Math.max(height, s.dom.offsetTop + s.dom.offsetHeight);
        } else if (vnode.state.mouseIn) {
          for (const c of drawerElement.children)
            height = Math.max(height, c.dom.offsetTop + c.dom.offsetHeight);
        }
        drawerElement.dom.style.height = height;
      }

      if (stagingElements.length + queueElements.length) {
        const statusCount = { queued: 0, pending: 0, fault: 0, stale: 0 };
        for (const t of queue) statusCount[t.status] += 1;

        const actions = m(
          ".actions",
          m(
            "button.primary",
            {
              title: "Commit queued tasks",
              disabled: !statusCount.queued,
              onclick: () => {
                const tasks = Array.from(taskQueue.getQueue()).filter(
                  t => t.status === "queued"
                );
                taskQueue
                  .commit(
                    tasks,
                    (deviceId, err, connectionRequestStatus, tasks2) => {
                      if (err) {
                        notifications.push(
                          "error",
                          `${deviceId}: ${err.message}`
                        );
                        return;
                      }

                      if (connectionRequestStatus !== "OK") {
                        notifications.push(
                          "error",
                          `${deviceId}: ${connectionRequestStatus}`
                        );
                        return;
                      }

                      for (const t of tasks2) {
                        if (t.status === "stale") {
                          notifications.push(
                            "error",
                            `${deviceId}: No contact from device`
                          );
                          return;
                        } else if (t.status === "fault") {
                          notifications.push(
                            "error",
                            `${deviceId}: Task(s) faulted`
                          );
                          return;
                        }
                      }

                      notifications.push(
                        "success",
                        `${deviceId}: Task(s) committed`
                      );
                    }
                  )
                  .then(() => {
                    store.fulfill(0, Date.now());
                  });
              }
            },
            "Commit"
          ),
          m(
            "button",
            {
              title: "Clear tasks",
              onclick: taskQueue.clear,
              disabled: !queueElements.length
            },
            "Clear"
          )
        );

        statusElement = m(
          ".status",
          m(
            "span.queued",
            { class: statusCount.queued ? "active" : "" },
            `Queued: ${statusCount.queued}`
          ),
          m(
            "span.pending",
            { class: statusCount.pending ? "active" : "" },
            `Pending: ${statusCount.pending}`
          ),
          m(
            "span.fault",
            { class: statusCount.fault ? "active" : "" },
            `Fault: ${statusCount.fault}`
          ),
          m(
            "span.stale",
            { class: statusCount.stale ? "active" : "" },
            `Stale: ${statusCount.stale}`
          ),
          actions
        );

        drawerElement = m(
          ".drawer",
          {
            key: "drawer",
            style: "opacity: 0;height: 0;",
            oncreate: vnode2 => {
              vnode.state.mouseIn = false;
              vnode2.dom.style.opacity = 1;
              resizeDrawer();
            },
            onmouseover: e => {
              vnode.state.mouseIn = true;
              resizeDrawer();
              e.redraw = false;
            },
            onmouseleave: e => {
              vnode.state.mouseIn = false;
              resizeDrawer();
              e.redraw = false;
            },
            onupdate: resizeDrawer,
            onbeforeremove: vnode2 => {
              vnode2.dom.onmouseover = vnode2.dom.onmouseleave = null;
              vnode2.dom.style.opacity = 0;
              vnode2.dom.style.height = 0;
              return new Promise(resolve => {
                setTimeout(resolve, 500);
              });
            }
          },
          statusElement,
          stagingElements.length ? stagingElements : m(".queue", queueElements)
        );
      }

      return m(
        "div.drawer-wrapper",
        drawerElement,
        m(
          "div.notifications-wrapper",
          {
            key: "notifications",
            style: "position: relative;",
            onupdate: repositionNotifications,
            oncreate: repositionNotifications
          },
          notificationElements
        )
      );
    }
  };
}
