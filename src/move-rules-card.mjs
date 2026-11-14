export const MOVE_RULES_CSS = `.mvrules-out.mvsrc>div{border-top:none;margin-top:0;padding-top:0}
.mvrules-out .mvrule+.mvrule{margin-top:6px}
.mvrules-out .mvrulesrc{opacity:.72;margin-top:1px}
.mvrules-out .mvrule-miss{margin-top:8px;opacity:.72}
`;

export function renderMoveRulesCard(task,r,EN){if(!r)return"";
  function esc(s){return (s==null?"":String(s)).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  function mvRuleVal(v,EN){return v===true?(EN?"Yes":"是"):v===false?(EN?"No":"否"):String(v==null?"":v);}
  if(!r.rows)return '<div class="pastebox mvrules" data-t="'+esc(task)+'"><textarea placeholder="'+(EN?"Paste the building's reply here":"把物业回的那封信整段贴在这里")+'">'+esc(r.text||"")+'</textarea></div>';
  if(!r.rows.length)return '<div class="mvsrc">'+(EN?"I couldn't read any of the move rules out of that. Paste the part that lists them, or fill them in on your profile.":"这段里我一条楼规都没读出来。把写规矩的那几句贴进来,或者去画像面板自己填。")+'</div>';
  return '<div class="mvrules-out mvsrc" data-t="'+esc(task)+'">'
    +r.rows.map(function(x){return '<div class="mvrule"><b>'+esc(x.label||"")+'</b>'+(EN?": ":"：")+esc(mvRuleVal(x.value,EN))+'<div class="mvrulesrc">'+esc(x.src||"")+'</div></div>'}).join("")
    +(r.missed&&r.missed.length?'<div class="mvrule-miss">'+(EN?"Not in the reply (left as they were): ":"回信里没写、原样不动：")+esc(r.missed.join(EN?", ":"、"))+'</div>':'')
    +'</div>';}
