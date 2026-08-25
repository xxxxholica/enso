import { Clerk } from "@clerk/clerk-js";
import { _setCurrentUser } from "./authState";

/**
 * アカウント機能（ログイン・新規登録・ログアウト・現在のユーザー表示）はClerkに任せる。
 * 自前のAPI(api.onunu.me)は使わない——ClerkがユーザーDB・セッション・ログインUIを丸ごと提供するため。
 * ログインはこのアプリを使うための必須条件ではない（未ログインでも通常通りメモは使える）。
 */

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

declare global {
  interface Window {
    __internal_ClerkUICtor?: unknown;
  }
}

/**
 * openSignIn/mountUserButton等のUI部分は@clerk/clerk-js本体に同梱されておらず、
 * publishable keyに埋め込まれたFrontend APIドメインから別バンドル(@clerk/ui)として
 * 読み込む必要がある。これをclerk.load()より先に済ませないと
 * 「Clerk was not loaded with Ui components」というエラーになる。
 */
async function loadClerkUiBundle(publishableKey: string): Promise<void> {
  const domainPart = publishableKey.split("_")[2];
  if (!domainPart) {
    throw new Error("publishable keyの形式が不正です（pk_test_... の形になっているか確認してください）");
  }
  const clerkDomain = atob(domainPart).slice(0, -1);

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("@clerk/ui バンドルの読み込みに失敗しました"));
    document.head.appendChild(script);
  });
}

/** ログイン中のみ有効な、セッショントークンを取得できるハンドル。クラウド同期(cloudSync.ts)に渡す。 */
export interface AuthSession {
  getToken: () => Promise<string | null>;
}

export async function mountAccountWidget(
  container: HTMLElement,
  onAuthChange?: (session: AuthSession | null) => void
): Promise<void> {
  if (!PUBLISHABLE_KEY) {
    const notice = document.createElement("span");
    notice.className = "account-badge account-badge-warning";
    notice.textContent = "アカウント機能: .env.local に VITE_CLERK_PUBLISHABLE_KEY が未設定です";
    container.appendChild(notice);
    return;
  }

  await loadClerkUiBundle(PUBLISHABLE_KEY);

  const clerk = new Clerk(PUBLISHABLE_KEY);
  await clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    appearance: {
      variables: {
        colorPrimary: "oklch(22% 0.012 55)",
        fontFamily: '"Noto Sans JP", sans-serif',
      },
    },
  } as Parameters<typeof clerk.load>[0]);

  const badge = document.createElement("div");
  badge.className = "account-badge";
  container.appendChild(badge);

  function renderSignedOut(): void {
    badge.innerHTML = "";
    const signInBtn = document.createElement("button");
    signInBtn.type = "button";
    signInBtn.className = "text-link";
    signInBtn.textContent = "ログイン / 新規登録";
    signInBtn.addEventListener("click", () => {
      void clerk.openSignIn({});
    });
    badge.appendChild(signInBtn);
  }

  function renderSignedIn(): void {
    badge.innerHTML = "";
    const userButtonSlot = document.createElement("div");
    userButtonSlot.className = "account-user-button";
    badge.appendChild(userButtonSlot);
    void clerk.mountUserButton(userButtonSlot);
  }

  let wasSignedIn = false;

  function sync(): void {
    const isSignedIn = Boolean(clerk.user);
    if (isSignedIn) {
      renderSignedIn();
    } else {
      renderSignedOut();
    }

    // onAuthChangeを先に呼び、setTokenGetter経由でapiClient.tsのトークン取得関数を
    // 用意してから_setCurrentUserで他モジュールに通知する。逆順だと、_setCurrentUser
    // が同期的に呼ぶリスナー（SharedRoomMenuの招待リンク自動参加など）がその場で
    // authFetchを呼んだ時、まだtokenGetterが設定されておらず「未ログインです」で
    // 失敗する——ログイン済みで開いた招待リンクの自動参加が効かない不具合の原因だった。
    if (isSignedIn !== wasSignedIn) {
      wasSignedIn = isSignedIn;
      onAuthChange?.(
        isSignedIn
          ? {
              getToken: async () => {
                const token = await clerk.session?.getToken();
                return token ?? null;
              },
            }
          : null
      );
    }

    // コラボ機能などの他モジュールが、Clerkの詳細を知らずに「今のユーザー」を読めるようにする。
    _setCurrentUser(
      clerk.user
        ? {
            id: clerk.user.id,
            name: clerk.user.fullName ?? clerk.user.username ?? "名前未設定",
            imageUrl: clerk.user.imageUrl,
          }
        : null
    );
  }

  clerk.addListener(() => sync());
  sync();
}
