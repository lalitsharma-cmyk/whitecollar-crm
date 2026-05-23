import { type NextRequest } from "next/server";

// Self-contained embed snippet served as JS.
// On the customer's website:
//   <script src="https://crm.whitecollarrealty.com/embed.js" data-key="wcr_live_..."></script>
//   <div id="wcr-lead-form" data-project="marina-bay"></div>

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const js = `(function(){
  var SCR = document.currentScript;
  var KEY = SCR && SCR.getAttribute('data-key') || '';
  var BASE = ${JSON.stringify(base)};
  var ENDPOINT = BASE + '/api/intake/website';

  function el(tag, attrs, html){
    var n = document.createElement(tag);
    if(attrs) for(var k in attrs) n.setAttribute(k, attrs[k]);
    if(html!=null) n.innerHTML = html;
    return n;
  }

  function mount(container){
    var project = container.getAttribute('data-project') || '';
    container.innerHTML = '';
    var card = el('div', { style: "font-family:system-ui,-apple-system,sans-serif;max-width:420px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px;box-shadow:0 6px 24px -10px rgba(11,26,51,.2)" });
    card.appendChild(el('div', { style:"font-size:11px;letter-spacing:.16em;color:#c9a24b;font-weight:700;margin-bottom:6px" }, 'WHITE COLLAR REALTY'));
    card.appendChild(el('h3', { style:"margin:0 0 14px;font-size:18px;color:#0b1a33" }, 'Talk to a property advisor'));

    var form = el('form');
    var fields = [
      ['name','Full name','text',true],
      ['phone','Phone (with country code)','tel',true],
      ['email','Email','email',false],
      ['configuration','Configuration (e.g. 2BHK)','text',false],
      ['message','Tell us what you\\'re looking for','textarea',false]
    ];
    fields.forEach(function(f){
      var wrap = el('div', { style:"margin-bottom:10px" });
      wrap.appendChild(el('label', { style:"display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:4px" }, f[1] + (f[3]?' *':'')));
      var input;
      if(f[2]==='textarea'){
        input = el('textarea', { name:f[0], rows:'3', style:"width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;font-family:inherit;outline:none" });
      } else {
        input = el('input', { name:f[0], type:f[2], style:"width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;outline:none" });
      }
      if(f[3]) input.setAttribute('required','required');
      input.addEventListener('focus', function(){ this.style.borderColor='#c9a24b'; });
      input.addEventListener('blur', function(){ this.style.borderColor='#e5e7eb'; });
      wrap.appendChild(input);
      form.appendChild(wrap);
    });

    var btn = el('button', { type:'submit', style:"width:100%;background:#0b1a33;color:#fff;font-weight:600;font-size:14px;padding:10px;border-radius:8px;border:none;cursor:pointer;margin-top:6px" }, 'Request a callback');
    btn.addEventListener('mouseenter', function(){ this.style.background='#0f2347'; });
    btn.addEventListener('mouseleave', function(){ this.style.background='#0b1a33'; });
    form.appendChild(btn);

    var msg = el('div', { style:"margin-top:10px;font-size:13px" });
    form.appendChild(msg);

    form.addEventListener('submit', function(e){
      e.preventDefault();
      var data = {};
      var fd = new FormData(form);
      fd.forEach(function(v,k){ data[k]=v; });
      if(project) data.project = project;
      var qs = (window.location.search||'').substring(1).split('&');
      qs.forEach(function(p){
        var kv = p.split('=');
        if(kv[0]==='utm_source') data.utmSource = decodeURIComponent(kv[1]||'');
        if(kv[0]==='utm_campaign') data.utmCampaign = decodeURIComponent(kv[1]||'');
      });
      btn.disabled = true; btn.textContent = 'Sending…';
      msg.textContent = ''; msg.style.color = '';
      fetch(ENDPOINT, {
        method:'POST',
        headers:{'Content-Type':'application/json','X-WCR-Key':KEY},
        body: JSON.stringify(data)
      }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
        .then(function(res){
          if(res.ok){
            msg.textContent = '✓ Thanks! An advisor will reach out shortly.';
            msg.style.color = '#16a34a';
            form.reset();
          } else {
            msg.textContent = (res.j && res.j.error) || 'Something went wrong. Please try again.';
            msg.style.color = '#dc2626';
          }
        })
        .catch(function(){ msg.textContent = 'Network error. Please try again.'; msg.style.color='#dc2626'; })
        .finally(function(){ btn.disabled=false; btn.textContent='Request a callback'; });
    });
    card.appendChild(form);
    container.appendChild(card);
  }

  function init(){
    var nodes = document.querySelectorAll('#wcr-lead-form, .wcr-lead-form');
    nodes.forEach(mount);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();`;

  return new Response(js, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
