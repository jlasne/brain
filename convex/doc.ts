/**
 * The connector documentation, served rather than published.
 *
 * It used to be a static page, which meant a client-side check could hide it
 * but never withhold it: the words were in the file either way. Holding them
 * here is the only gate that actually gates, because an unsigned request gets
 * the refusal instead of the text.
 *
 * The page that renders this is one shell in the app, so the session it already
 * holds is the credential. No second sign-in, and no copy of the words on disk.
 */

export const DOC_STYLE = `
  .says{ margin-top:12px; display:grid; gap:9px; grid-template-columns:repeat(auto-fit,minmax(252px,1fr)); }
  .says div{
    border:1px solid var(--line); border-left:2px solid var(--accent-line);
    border-radius:10px; background:var(--surface); padding:12px 14px;
    font:400 14px/1.5 var(--sans); color:var(--ink-2);
  }
  .card ol{ margin:0; padding-left:18px; }
  .card li{ font-size:14px; line-height:1.6; color:var(--ink-3); margin-bottom:5px; }
  .card li:last-child{ margin-bottom:0; }
  .card li b{ color:var(--ink); font-weight:600; }
  .two{ display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(252px,1fr)); margin-top:14px; }
  .two .card h3{ display:flex; align-items:center; gap:7px; }
  .two .card .tick{ color:var(--good); font-size:13px; }
  .two .card .bar{ color:var(--ink-4); font-size:13px; }
  .two ul{ margin-top:8px; }
  .two li{ list-style:none; font-size:14px; line-height:1.6; color:var(--ink-3); padding-left:14px; position:relative; }
  .two li::before{ content:"·"; position:absolute; left:3px; color:var(--ink-4); }
  .toc{ display:flex; flex-wrap:wrap; gap:7px; margin-top:22px; }
  .toc a{
    font:500 12.5px/1 var(--sans); padding:7px 11px; border-radius:7px;
    border:1px solid var(--line-2); color:var(--ink-2); background:var(--surface);
  }
  .toc a:hover{ border-color:var(--accent-fill); color:var(--accent); text-decoration:none; }
  h2{ scroll-margin-top:70px; }
  footer.bot .wrap{ justify-content:space-between; }
`;

export const DOC_BODY = `

  <div class="eyebrow">Connect it</div>
  <h2 style="margin-top:6px">Use your brains from any AI client.</h2>
  <p class="lede">One address turns any MCP client into a reader of every brain. A second address, tied
    to your account, lets it drop sources and make brains too.</p>

  <nav class="toc">
    <a href="#addresses">The two addresses</a>
    <a href="#add">How to add it</a>
    <a href="#send">What you can send</a>
    <a href="#rule">What you rule</a>
    <a href="#tools">The tools</a>
  </nav>

  <h2 id="addresses">The two addresses</h2>
  <p>Paste one into your client as a remote MCP server over HTTP. Leave authentication empty. A
    <b>Connect</b> or <b>Sign in</b> button can be skipped, because Octopus has no login for that
    handshake to answer.</p>

  <h3 style="margin-top:22px">Read every brain</h3>
  <div class="urlbox" style="margin-top:8px">
    <input id="docUrl" readonly spellcheck="false" value="loading">
    <button id="docCopy">Copy</button>
  </div>
  <p class="muted" style="margin-top:8px">No key, no account, nothing spent. Anyone can use this one.</p>

  <h3 style="margin-top:22px">Read and feed</h3>
  <p class="muted" style="margin-top:8px">Sign in to Octopus, click <b>Octopus MCP</b> in the sidebar,
    then <b>Make my address</b>. It carries your account, so a client holding it can feed the brains you
    own, plus any brain its owner marked open. Keep it private.</p>

  <div class="note">Feeding spends nothing here. Your client reads the source, files it and writes the
    new position. Your model key stays for the web app.</div>

  <h2 id="add">How to add it</h2>

  <h3 style="margin-top:20px">Claude</h3>
  <ol class="steps">
    <li>Open <b>Settings</b>, then <b>Connectors</b>.</li>
    <li>Choose <b>Add custom connector</b> and paste the address.</li>
    <li>Leave authentication empty and save.</li>
  </ol>

  <h3>ChatGPT</h3>
  <ol class="steps">
    <li>Open <b>Settings</b>, then <b>Connectors</b>.</li>
    <li>Add a remote MCP server and paste the address.</li>
    <li>Custom connectors move between plans, so an option you cannot find is usually a plan limit
      rather than a mistake.</li>
  </ol>

  <h3>Everything else</h3>
  <p>Cursor, VS Code, Zed, LibreChat and the rest take the same address wherever they list MCP servers.
    Writing your own client works too: the endpoint speaks Streamable HTTP, so one POST carrying one
    JSON-RPC request gets one JSON object back. It issues no session id and holds no state between
    calls.</p>

  <h2 id="send">What you can send</h2>
  <div class="tbl"><table>
    <tr><th>You send</th><th>What happens</th></tr>
    <tr><td><b>A PDF attached in the chat</b></td><td>Your client reads the file and files it. Attach it
      and say which brain.</td></tr>
    <tr><td><b>A document or slides you attach</b></td><td>Same. Anything your client can open, it can drop.</td></tr>
    <tr><td><b>A screenshot</b></td><td>Your client reads the text in the picture, then files that.</td></tr>
    <tr><td>Text you paste</td><td>Works on its own. Add the link when there is one.</td></tr>
    <tr><td>An article or a blog link</td><td>The link alone is enough. Your client opens the page, or calls
      <code>fetch_link</code> when it cannot browse.</td></tr>
    <tr><td>A paper or a study link</td><td>Same, when the text sits on the page rather than behind a login.</td></tr>
    <tr><td>A YouTube, TikTok, Instagram or X link</td><td>The link alone is enough when a transcript
      service is configured, because YouTube hands captions to a signed-in browser and to nothing else.
      Without one, paste the transcript with the link.</td></tr>
    <tr><td>A podcast or another video host</td><td>Paste the transcript. Octopus reads text.</td></tr>
  </table></div>
  <p class="muted">Always send the link when one exists. It is what catches a repeat later.</p>

  <h2>Then talk to it</h2>
  <div class="says">
    <div>"Drop this into Content: https://..."</div>
    <div>[PDF attached] "Drop this into Wealth."</div>
    <div>"Make me a brain for negotiation tactics."</div>
    <div>"What do my brains say about hooks?"</div>
  </div>

  <h2 id="rule">What you see before anything is stored</h2>
  <p>Your client shows the card, then waits. The card names where the source lands, which positions it
    touches, what is new, what repeats an earlier source, and every claim that contradicts what you
    already hold, with the date on both sides.</p>
  <div class="grid" style="margin-top:14px">
    <div class="card">
      <h3>You rule each contradiction</h3>
      <ol>
        <li><b>New wins.</b> The position flips, and the old view moves into the evidence with its date.</li>
        <li><b>Mine wins.</b> The stored position holds, and the new claim joins the evidence.</li>
        <li><b>Keep both.</b> The position holds and the clash is recorded, dated, with the reason.</li>
      </ol>
    </div>
    <div class="card">
      <h3>Then it writes</h3>
      <p>Each position is re-derived from its whole evidence list, never appended to. A new idea the
        source argues for becomes a position of its own in the same drop.</p>
    </div>
  </div>

  <h2 id="tools">The tools it exposes</h2>
  <p class="muted">Six on the read address.</p>
  <div class="tbl"><table>
    <tr><th>Tool</th><th>What it returns</th></tr>
    <tr><td><code>ask</code></td><td>Start here. A question, optionally a brain. Returns the positions that
      bear on it, their dated evidence, the data, any open conflict, and how to write the answer.</td></tr>
    <tr><td><code>list_brains</code></td><td>Every readable brain with its scope line and its counts.</td></tr>
    <tr><td><code>read_brain</code></td><td>One brain's scope plus one line per concept.</td></tr>
    <tr><td><code>read_concept</code></td><td>A position, its evidence with authors and dates, its data, its open conflicts.</td></tr>
    <tr><td><code>search_brains</code></td><td>Keyword matches across every concept, title hits ranked first.</td></tr>
    <tr><td><code>list_sources</code></td><td>What a brain has read, newest first, with links.</td></tr>
  </table></div>

  <p class="muted" style="margin-top:20px">Six more on your own address. The drop steps run in order, and
    nothing is written until the last one.</p>
  <div class="tbl"><table>
    <tr><th>Tool</th><th>Your client does</th><th>Octopus does</th></tr>
    <tr><td><code>create_brain</code></td><td>Names it and writes the scope line</td>
      <td>Makes it, owned by you. Refuses a scope line too vague to gate anything</td></tr>
    <tr><td><code>fetch_link</code></td><td>Asks for a page it cannot open</td>
      <td>Returns the readable text. Stores none of it</td></tr>
    <tr><td><code>drop_source</code></td><td>Reads the source, keeps what matters</td>
      <td>Catches a repeat, hands back your brains and the filing rules</td></tr>
    <tr><td><code>drop_plan</code></td><td>Files it against your concepts</td>
      <td>Checks every concept id, returns the card</td></tr>
    <tr><td><code>drop_prepare</code></td><td>Asks you which side holds</td>
      <td>Returns the whole evidence list and the rewriting rules</td></tr>
    <tr><td><code>drop_store</code></td><td>Rewrites each position</td>
      <td>Writes it, returns the receipt</td></tr>
  </table></div>
  <p class="muted">Octopus checks the result at every step. A client that ignores the rules gets the
    rules back rather than a brain full of junk.</p>

  <h2>What a reader gets</h2>
  <div class="two">
    <div class="card">
      <h3><span class="tick">&#10003;</span> Yours to read</h3>
      <ul>
        <li>Every brain and its scope line</li>
        <li>Positions, evidence, dates, authors</li>
        <li>Open conflicts on both sides</li>
        <li>The sources behind a brain, with links</li>
      </ul>
    </div>
    <div class="card">
      <h3><span class="bar">&#8212;</span> Held back</h3>
      <ul>
        <li>Writing, without a personal address</li>
        <li>Raw source text, which was never stored</li>
        <li>Anything past 120 calls per 10 minutes</li>
      </ul>
    </div>
  </div>

  <h2>Two things worth knowing</h2>
  <div class="grid">
    <div class="card">
      <h3>Keep your address private</h3>
      <p>Whoever holds it can feed the brains you can feed. Replace it or turn it off from the same
        sidebar panel, and any client holding the old one drops back to reading.</p>
    </div>
    <div class="card">
      <h3>The source text is never stored</h3>
      <p>Only what your client kept from it: the ideas, the numbers, the dates and the exact quotes.
        The transcript itself lands nowhere.</p>
    </div>
  </div>

`;
