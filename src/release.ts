export const webRelease = import.meta.env.PUBLIC_WEB_RELEASE || 'dev';
export const webReleaseLabel = webRelease === 'dev' ? 'dev' : webRelease.slice(0, 12);
