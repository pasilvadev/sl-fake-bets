import { buildTag } from "@/lib/build-info";

/**
 * Inline, dependency-free fallback for when the page's OWN static assets —
 * JS chunks, CSS, the self-hosted Geist font files — fail to load at all.
 *
 * Found investigating a Google-login 499 (2026-09-09, Kécia/"soulless"): her
 * console showed every one of those requests aborting (`net::ERR_ABORTED
 * 499`), including `favicon.ico`, while the initial HTML document rendered
 * fine — a hostile network path (firewall/DPI/parental-control filtering,
 * most plausibly one that categorically blocks `*.vercel.app` as "free
 * hosting") killing everything downstream of the first request. Confirmed
 * network-side, not app code (she signed in fine over 5G). This can't fix
 * that block — only turn "blank unstyled page, no idea why" into a legible
 * message and a retry button.
 *
 * A raw `<script>`, deliberately NOT `next/script` (as JSON-LD in `page.tsx`
 * already does the same for the same reason): rendering with `next/script`
 * — even `strategy="beforeInteractive"` — was verified (build + rendered
 * HTML inspection) to only PUSH this code's text onto a `self.__next_s`
 * queue; a Next runtime chunk is what actually reads that queue and runs it.
 * That chunk is exactly the kind of file the incident showed failing to
 * load at all, which would have silently disarmed the one thing meant to
 * report that failure. A plain `<script>` with no `src`/`async`/`defer`
 * executes the instant the HTML parser reaches it — no chunk, no queue, no
 * dependency on anything that can be blocked. It must also NOT depend on
 * next-intl, `messages/*.json`, Tailwind classes, or any other house
 * component — every one of those is itself a chunk that may be among the
 * ones that failed. The two-sentence copy below is the one deliberate
 * exception to "no user-visible string outside the message catalogs" (see
 * `i18n/messages.ts`) — there is no other way to say anything at all in this
 * failure mode. Styled with inline `style.cssText` rather than a class for
 * the same reason the copy is hardcoded: the stylesheet may be exactly what
 * didn't arrive.
 */
export function ConnectionFallbackScript() {
  const tag = buildTag();

  return (
    <script
      // Same justification as the JSON-LD script in page.tsx: the payload is
      // this module's own literal (a build-time string plus fixed source
      // below), never user data — the only condition under which this prop
      // is safe.
      dangerouslySetInnerHTML={{
        __html: `(function () {
        try {
          var failures = 0, shown = false;
          function isCritical(t) {
            if (!t || !t.tagName) return false;
            var tag = t.tagName.toLowerCase();
            if (tag === "script") return true;
            if (tag === "link" && (t.rel === "stylesheet" || t.rel === "preload")) return true;
            return false;
          }
          function mount() {
            var tag = ${JSON.stringify(tag)};
            var pt = document.documentElement.lang === "pt-BR";
            var msg = pt
              ? "A página não carregou por completo — geralmente é a rede do aparelho (wifi, firewall, VPN), não o SL. Tenta outra rede (ex.: dados móveis) ou recarrega."
              : "The page didn't fully load — usually the device's network (wifi, firewall, VPN), not SL. Try another network (e.g. mobile data) or reload.";
            var retry = pt ? "Recarregar" : "Reload";
            var bar = document.createElement("div");
            bar.id = "sl-connection-fallback";
            bar.setAttribute("role", "alert");
            bar.style.cssText = "position:fixed;inset:auto 0 0 0;z-index:2147483647;background:#111;color:#fff;padding:12px 16px;font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;gap:12px;align-items:center;justify-content:space-between;box-shadow:0 -2px 12px rgba(0,0,0,.35)";
            var text = document.createElement("span");
            text.textContent = tag ? msg + " (" + tag + ")" : msg;
            var btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = retry;
            btn.style.cssText = "flex:none;background:#fff;color:#111;border:0;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer";
            btn.onclick = function () { location.reload(); };
            bar.appendChild(text);
            bar.appendChild(btn);
            document.body.appendChild(bar);
          }
          function showFallback() {
            if (shown) return;
            shown = true;
            if (document.body) mount();
            else document.addEventListener("DOMContentLoaded", mount, { once: true });
          }
          // Capture phase: a failed resource fires "error" on the element
          // itself and does NOT bubble, so this is the only place to catch it
          // for every script/link tag at once rather than wiring a per-tag
          // onerror. Two failures, not one, before showing anything — a
          // single blocked resource (one extension rule, one flaky font) is
          // not the same signal as the whole app failing to arrive.
          window.addEventListener("error", function (e) {
            if (isCritical(e.target)) {
              failures++;
              if (failures >= 2) showFallback();
            }
          }, true);
        } catch (e) {}
      })();`,
      }}
    />
  );
}
