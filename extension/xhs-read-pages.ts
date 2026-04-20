export type XhsReadTargetPage = "search_result_tab" | "explore_detail_tab" | "profile_tab";

export const isXhsReadBootstrapTargetPage = (value: unknown): value is XhsReadTargetPage =>
  value === "search_result_tab" || value === "explore_detail_tab" || value === "profile_tab";

export const resolveXhsReadTargetPageFromHref = (href: string): XhsReadTargetPage | null => {
  try {
    const url = new URL(href, "https://www.xiaohongshu.com/");
    if (url.hostname !== "www.xiaohongshu.com") {
      return null;
    }
    if (url.pathname.startsWith("/search_result")) {
      return "search_result_tab";
    }
    if (url.pathname.startsWith("/explore/")) {
      return "explore_detail_tab";
    }
    if (url.pathname.startsWith("/user/profile/")) {
      return "profile_tab";
    }
    return null;
  } catch {
    return null;
  }
};

export const shouldAutoInstallXhsReadRequestContextCapture = (href: string): boolean =>
  resolveXhsReadTargetPageFromHref(href) !== null;
