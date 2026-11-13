const $ = selector => document.querySelector(selector);
const messages = [];
let busy = false;

function welcome() {
  const container = $('#chat-messages');
  container.replaceChildren();
  const intro = document.createElement('div');
  intro.className = 'chat-welcome';
  const title = document.createElement('h2');
  title.textContent = 'A little clarity, on demand.';
  const description = document.createElement('p');
  description.textContent = 'Ask about projects, deadlines, submissions, or recorded changes. I use a fresh snapshot of your workspace for each answer.';
  intro.append(title, description);
  for (const text of ["What’s overdue?", 'Which projects need attention?', 'What changed in the last seven days?']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-suggestion';
    button.textContent = text;
    button.addEventListener('click', () => ask(text));
    intro.append(button);
  }
  container.append(intro);
}

function appendMessage(role, content, data) {
  const article = document.createElement('article');
  article.className = `chat-message chat-${role}`;
  const label = document.createElement('span');
  label.className = 'chat-speaker';
  label.textContent = role === 'user' ? 'You' : 'LLM';
  const text = document.createElement('p');
  text.className = 'chat-message-text';
  text.textContent = content;
  article.append(label, text);
  if (data?.snapshotAt) {
    const stamp = document.createElement('span');
    stamp.className = 'chat-snapshot-time';
    stamp.textContent = `Data refreshed ${new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(data.snapshotAt))}`;
    article.append(stamp);
  }
  if (data?.sources?.length) {
    const details = document.createElement('details');
    details.className = 'chat-sources';
    const summary = document.createElement('summary');
    summary.textContent = `${data.sources.length} workspace ${data.sources.length === 1 ? 'source' : 'sources'}`;
    details.append(summary);
    for (const source of data.sources) {
      const block = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = source.label;
      const excerpt = document.createElement('pre');
      excerpt.textContent = source.excerpt;
      block.append(name,excerpt);
      details.append(block);
    }
    article.append(details);
  }
  $('#chat-messages').append(article);
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}

function setBusy(value) {
  busy = value;
  $('#chat-input').disabled = value;
  $('#chat-send').disabled = value;
  $('#chat-clear').disabled = value;
  $('#chat-send').textContent = value ? '…' : '↑';
  $('#chat-form').setAttribute('aria-busy',String(value));
  document.querySelectorAll('.chat-suggestion').forEach(button => {button.disabled=value;});
  $('#chat-connection').textContent = value ? 'Reading the latest workspace…' : 'Answers from your workspace';
}

async function ask(value) {
  if (busy || !value.trim()) return;
  const message = value.trim();
  const history = messages.slice(-6).map(item => ({role:item.role,content:item.content.slice(0,1000)}));
  appendMessage('user',message);
  messages.push({role:'user',content:message});
  $('#chat-input').value = '';
  $('#chat-error').hidden = true;
  setBusy(true);
  try {
    const response = await fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,history,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),signal:AbortSignal.timeout(65_000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The LLM could not answer right now.');
    appendMessage('assistant',data.answer,data);
    messages.push({role:'assistant',content:data.answer});
  } catch (error) {
    $('#chat-error').textContent = error.name === 'TimeoutError' ? 'The request took too long. Try the question again.' : error.message;
    $('#chat-error').hidden = false;
    $('#chat-input').value = message;
  } finally {
    setBusy(false);
    if (!$('#chat-panel').hidden) $('#chat-input').focus();
  }
}

$('#chat-toggle').addEventListener('click', () => {
  const open = $('#chat-panel').hidden;
  $('#chat-panel').hidden = !open;
  $('#chat-toggle').setAttribute('aria-expanded',String(open));
  if (open && !busy) $('#chat-input').focus();
});
$('#chat-close').addEventListener('click', () => {$('#chat-panel').hidden=true;$('#chat-toggle').setAttribute('aria-expanded','false');$('#chat-toggle').focus();});
$('#chat-clear').addEventListener('click', () => {if (!busy) {messages.length=0;welcome();$('#chat-error').hidden=true;$('#chat-input').value='';$('#chat-input').focus();}});
$('#chat-form').addEventListener('submit',event => {event.preventDefault();void ask($('#chat-input').value);});
$('#chat-input').addEventListener('keydown',event => {if(event.key==='Enter' && !event.shiftKey){event.preventDefault();if(!busy && event.currentTarget.value.trim()) $('#chat-form').requestSubmit();}});
welcome();
fetch('/api/chat/status').then(response=>response.json()).then(status=>{$('#chat-connection').textContent=status.configured?'Answers from your workspace':'Server setup needed';}).catch(()=>{$('#chat-connection').textContent='Connection unavailable';});
