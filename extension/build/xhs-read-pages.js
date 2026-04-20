export const isXhsReadBootstrapTargetPage = (value) => value === "search_result_tab" || value === "explore_detail_tab" || value === "profile_tab";
export const resolveXhsReadTargetPageFromHref = (href) => {
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
    }
    catch {
        return null;
    }
};
export const shouldAutoInstallXhsReadRequestContextCapture = (href) => resolveXhsReadTargetPageFromHref(href) !== null;
