import { createStore, Provider } from "jotai";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatTabs } from "@/components/chat/ChatTabs";
import {
  chatTabSessionStorageAtom,
  recentViewedChatIdsAtom,
  type ChatTabSession,
} from "@/atoms/chatAtoms";

const mocks = vi.hoisted(() => ({
  selectChat: vi.fn(),
  router: {
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({
    loading: false,
    chats: [1, 2, 3, 4, 5].map((id) => ({
      id,
      appId: 1,
      title: `Chat ${id}`,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      chatMode: null,
      isFavorite: false,
    })),
  }),
}));

vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({
    apps: [{ id: 1, name: "Test app" }],
  }),
}));

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat: mocks.selectChat }),
}));

vi.mock("@/hooks/useReopenClosedTab", () => ({
  useReopenClosedTab: () => ({
    reopenClosedTab: vi.fn(),
    hasClosedTabs: false,
    lastClosedTab: null,
  }),
}));

vi.mock("@/hooks/useChatModeToggle", () => ({
  useIsMac: () => false,
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useStreamFinished: vi.fn(),
}));

vi.mock("@/hooks/useChatStream", () => ({
  useChatStreamState: () => undefined,
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enableMultiWindow: false },
  }),
}));

vi.mock("@/preview_iframe/PreviewIframeProvider", () => ({
  usePreviewIframeManager: () => ({
    getSnapshot: vi.fn(),
    send: vi.fn(),
  }),
}));

vi.mock("@/ipc/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ipc/types")>();
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      windowInfrastructure: {
        ...actual.ipc.windowInfrastructure,
        setChatTabOwnership: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => mocks.router,
  useRouterState: ({ select }: { select: (state: any) => unknown }) =>
    select({ location: { pathname: "/", href: "/" } }),
}));

interface FakeDataTransfer {
  effectAllowed: string;
  dropEffect: string;
  types: string[];
  setData: (type: string, value: string) => void;
  getData: (type: string) => string;
}

function createDataTransfer(): FakeDataTransfer {
  const data = new Map<string, string>();
  const dataTransfer: FakeDataTransfer = {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    types: [],
    setData(type, value) {
      data.set(type, value);
      dataTransfer.types = Array.from(data.keys());
    },
    getData(type) {
      return data.get(type) ?? "";
    },
  };
  return dataTransfer;
}

// happy-dom has no DragEvent, so fireEvent would drop the dataTransfer init.
// React reads dataTransfer off the native event, so attach it by hand.
function fireDragEvent(
  element: Element,
  type: "dragstart" | "dragover" | "drop" | "dragend",
  dataTransfer: FakeDataTransfer,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(element, event);
}

function renderTabs(selectedChatId: number | null = null) {
  const store = createStore();
  const session: ChatTabSession = {
    openChatIds: [1, 2, 3, 4, 5],
    selectedChatId,
    closedChatIds: [],
    updatedAt: 0,
  };
  store.set(chatTabSessionStorageAtom, session);
  const view = render(
    <Provider store={store}>
      <ChatTabs selectedChatId={selectedChatId} />
    </Provider>,
  );
  return { store, view };
}

async function waitForTabs() {
  await waitFor(() =>
    expect(screen.getByTestId("chat-tab-overflow-trigger")).toBeTruthy(),
  );
  // Three visible tabs and two overflow tabs at the unmeasured fallback width.
  expect(screen.getByTestId("chat-tab-3")).toBeTruthy();
  expect(screen.queryByTestId("chat-tab-4")).toBeNull();
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ChatTabs overflow drag", () => {
  it("moves a visible tab into the overflow dropdown", async () => {
    const { store } = renderTabs();
    await waitForTabs();

    const dataTransfer = createDataTransfer();
    fireDragEvent(screen.getByTestId("chat-tab-1"), "dragstart", dataTransfer);
    fireDragEvent(
      screen.getByTestId("chat-tab-overflow-trigger"),
      "dragover",
      dataTransfer,
    );
    fireDragEvent(
      screen.getByTestId("chat-tab-overflow-trigger"),
      "drop",
      dataTransfer,
    );

    await waitFor(() =>
      expect(store.get(recentViewedChatIdsAtom)).toEqual([2, 3, 4, 1, 5]),
    );
    // The dragged tab left the visible strip.
    expect(screen.queryByTestId("chat-tab-1")).toBeNull();
  });

  it("drags a tab out of the overflow dropdown onto the visible strip", async () => {
    const user = userEvent.setup();
    const { store } = renderTabs();
    await waitForTabs();

    await user.click(screen.getByTestId("chat-tab-overflow-trigger"));
    const overflowItem = await screen.findByTestId("chat-tab-overflow-4");

    const dataTransfer = createDataTransfer();
    fireDragEvent(overflowItem, "dragstart", dataTransfer);
    fireDragEvent(screen.getByTestId("chat-tab-2"), "dragover", dataTransfer);
    fireDragEvent(screen.getByTestId("chat-tab-2"), "drop", dataTransfer);

    await waitFor(() =>
      expect(store.get(recentViewedChatIdsAtom)).toEqual([1, 4, 2, 3, 5]),
    );
    // The dragged tab joined the visible strip and pushed the last visible
    // tab into overflow.
    expect(screen.getByTestId("chat-tab-4")).toBeTruthy();
    // The menu closes so the promoted tab is not hidden behind it.
    await waitFor(() =>
      expect(screen.queryByTestId("chat-tab-overflow-5")).toBeNull(),
    );
  });

  it("keeps the selected tab on the visible strip when it is dropped on the dropdown", async () => {
    const { store } = renderTabs(1);
    await waitForTabs();

    const dataTransfer = createDataTransfer();
    fireDragEvent(screen.getByTestId("chat-tab-1"), "dragstart", dataTransfer);
    fireDragEvent(
      screen.getByTestId("chat-tab-overflow-trigger"),
      "dragover",
      dataTransfer,
    );
    fireDragEvent(
      screen.getByTestId("chat-tab-overflow-trigger"),
      "drop",
      dataTransfer,
    );

    expect(store.get(recentViewedChatIdsAtom)).toEqual([1, 2, 3, 4, 5]);
    expect(screen.getByTestId("chat-tab-1")).toBeTruthy();
  });
});
