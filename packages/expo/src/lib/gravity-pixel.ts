export const GRAVITY_PIXEL_ID = "81e8d662-1d70-4f36-af3e-2c57d1edef9a";

export const GRAVITY_PIXEL_CONFIG = `
  window.GRAVITY_PIXEL_CONFIG = {
    inAppBrowser: true,
    pixel_id: "${GRAVITY_PIXEL_ID}"
  };
  true;
`;

export const GRAVITY_PIXEL_LOADER = `
  !function(w,d,t,u,n,a,m){w['GravityPixelObject']=n;w[n]=w[n]||function(){
  (w[n].q=w[n].q||[]).push(arguments)},w[n].l=1*new Date();a=d.createElement(t),
  m=d.getElementsByTagName(t)[0];a.async=1;a.src=u;m.parentNode.insertBefore(a,m)
  }(window,document,'script','https://code.trygravity.ai/gr-pix.js','gravity');
  gravity('init', '${GRAVITY_PIXEL_ID}');
  true;
`;
