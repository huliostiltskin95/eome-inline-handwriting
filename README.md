# EOME Inline Handwriting

Fork sperimentale di [Excerpt-Outline-Mindmap-Editor](https://github.com/kpaede/Excerpt-Outline-Mindmap-Editor) di Kornelius Paede, distribuito secondo la stessa licenza MIT.

Questa versione aggiunge **scrittura a mano direttamente nei nodi della mappa**, senza aprire il relativo editor. È destinata alla prova su Obsidian mobile (iPad / Apple Pencil, dispositivi BOOX con stilo) e desktop con penna compatibile.

## Installazione con BRAT

1. Apri Obsidian → Plugin della comunità e installa/attiva **BRAT**.
2. In BRAT seleziona **Add beta plugin for testing** e inserisci `huliostiltskin95/eome-inline-handwriting`.
3. Verifica che nel repository sia disponibile una release con `main.js`, `manifest.json` e `styles.css`.
4. Attiva **EOME Inline Handwriting** in Plugin della comunità.

Il plugin ha un **ID diverso dall'originale**, quindi non ne sovrascrive i file. Per evitare che entrambi cerchino di gestire le stesse note, si consiglia di **disattivare il plugin EOME originale durante le prove**.

## 0.4.1 — Schede Obsidian e modifica avanzata dei nodi

Le mappe `mindmap-eome` si aprono in una **scheda standard di Obsidian**, separata dalla nota Markdown, e non in una finestra modale. La scheda può essere affiancata o chiusa come qualsiasi altro pannello. Il contenuto modificabile resta sempre il singolo blocco selezionato: gli altri blocchi e la frontmatter della nota sono preservati.

- **Creare una mappa:** esegui il comando **EOME: inserisci nuovo blocco mappa** tramite la palette comandi (o il menu Slash Commands quando disponibile). Viene aggiunto un blocco Markdown vuoto `mindmap-eome` e il cursore viene posizionato al suo interno.
- **Aprire la mappa:** posiziona il cursore nel blocco ed esegui **EOME: apri la mappa del blocco al cursore**, oppure premi il pulsante di espansione dell'anteprima. EOME apre una nuova scheda.
- **Scrittura rapida:** seleziona un nodo SVG e scrivi con penna o mouse; `—+` crea un parallelo e `└+` un dettaglio a L.
- **Editor avanzato:** seleziona un nodo e premi **Modifica nodo** nella barra degli strumenti. L'editor vettoriale completo consente di correggere e organizzare i tratti; è ancora accessibile con doppio clic sul nodo.
- **Ritorno alla nota:** chiudi la scheda EOME. Gli SVG e i collegamenti sono già salvati; la nota mantiene il blocco e mostra la mappa aggiornata.

**Nota sullo slash:** il menu slash è una funzione di Obsidian/di eventuali plugin di comandi. Il comando EOME è registrato nel sistema comandi ed è sempre richiamabile tramite palette; l'elenco `/` può essere limitato all'editor o non funzionare dentro un blocco di codice.

## 0.4.5 — Selezione dei nodi, menu contestuale e inserimento in serie

Nella scheda EOME:
- **Clic del mouse o tocco breve:** seleziona un nodo manoscritto; il bordo evidenziato indica quale parola chiave è attiva. Il doppio clic apre direttamente l'editor avanzato.
- **Clic destro / pressione prolungata su touchscreen:** apre il menu del nodo, con **Modifica nodo**, **Nuovo parallelo** e **Nuovo ramo a L**. Le voci per i nuovi rami aprono subito l'editor avanzato.
- **Penna:** continua a scrivere direttamente sugli SVG nella mappa. Per evitare che un normale clic sul Mac diventi un tratto, la scrittura diretta con mouse richiede il pulsante **Disegna col mouse** (oppure Alt mentre si trascina).
- **Editor avanzato, «Salva + parallelo» e «Salva + L»:** salva il nodo corrente e apre **subito** il foglio del nodo collegato, senza passare dalla mappa. Anche il nuovo foglio può usare «Salva + …» per proseguire in serie. Premendo **Salva** senza collegamenti si torna alla mappa; annullare il foglio successivo non crea un SVG vuoto.

Le operazioni funzionano sia sulla mappa ordinaria sia sulla visualizzazione alternativa degli SVG, prevista quando il renderer grafico non è disponibile.

## Specifica tecnica dei collegamenti

Il sistema di relazioni e routing della versione 0.2.8 è **provvisorio**. Le nuove regole richieste sono: **figlio/conseguenza = linea orizzontale**; **dettaglio/causa = L ortogonale**; frecce personalizzabili su **ogni singola relazione**, indipendentemente dal tipo. Le relazioni sono stabilite **tra coppie esplicite di nodi**, non dedotte dalla loro posizione o dall'ordine dell'outline. Le linee possono condividere dorsali dove questo migliora la leggibilità.

La [specifica funzionale completa](docs/specs/relazioni-e-collegamenti.md) resta il documento di riferimento; le funzioni implementate sono descritte nelle sezioni dedicate alle release.

## 0.3.4 — Una mappa scrivibile dentro la nota, come un blocco Mermaid

Ora puoi inserire una mappa manoscritta **nel corpo della stessa nota Obsidian**, senza creare prima un'altra nota Markdown. In modalità lettura (o Live Preview, se il blocco viene renderizzato) basta creare un blocco vuoto:

````markdown
```mindmap-eome
```
````

EOME mostra «+ Crea la prima parola». Ogni nuovo nodo è salvato come **SVG editabile**; le corrispondenti righe di riferimento vengono inserite *automaticamente nel blocco di codice stesso*. Dopo qualche aggiunta, il contenuto sorgente somiglierà a:

````markdown
```mindmap-eome
- ![[Parola1.svg]]
  - ![[Parola2.svg]]
```
````

Seleziona la grafia, premi **+**, scegli «Parallelo —» oppure «A L └» e l'eventuale freccia. Scrivi direttamente sullo SVG con penna o mouse. Il doppio tocco apre l'editor grafico espanso. Le relazioni sono memorizzate nella **frontmatter YAML della stessa nota**, mentre i tratti restano in allegati SVG, non in dati raster.

Nell'editor espanso i comandi ora sono **«Salva + parallelo —»** e **«Salva + L └»**. Dalla mappa completa puoi scegliere «Frecce dei collegamenti...» nel menu contestuale di un nodo, senza dover centrare un tratto sottile. Dopo l'aggiunta di un nodo, EOME aggiorna l'outline prima di salvare il collegamento, riducendo i rapporti mancanti.

**Retrocompatibilità:** un blocco `mindmap-eome` con *solo* il percorso di un'altra nota Markdown continua a funzionare come anteprima, non come superficie modificabile. La nuova modalità interattiva richiede un blocco vuoto o un elenco di nodi SVG. Il supporto del rendering in Live Preview e i gesti Apple Pencil devono essere verificati su un iPad reale.

**Sicurezza:** prima di modificare il codice della nota EOME controlla che il corpo originale del blocco corrisponda; in presenza di più blocchi identici non distinguibili rifiuta l'operazione anziché rischiare di sovrascrivere il contenuto sbagliato.

## Solo input grafico: penna oppure mouse (0.3.3)

Nella **vista EOME**, i nodi nuovi si creano esclusivamente come **disegni SVG**, senza un campo di testo. Puoi scrivere direttamente con Apple Pencil, una penna compatibile o il mouse; il dito rimane utile per selezionare e navigare. I nodi di testo preesistenti vengono mostrati in sola lettura. Il Markdown sottostante è ancora modificabile dall'editor standard di Obsidian, che non fa parte della vista EOME.

Seleziona un nodo e apri il menu contestuale (pressione lunga o clic destro), oppure premi **+**. Scegli **Nuovo nodo parallelo —** o **Nuovo nodo a L └**, quindi seleziona **senza freccia / freccia iniziale / freccia finale / freccia doppia**. La scelta viene conservata sulla singola relazione. I collegamenti partono ora dal **lato** dell'immagine manoscritta, con un piccolo margine per non coprire la grafia. Una L fra due nodi allineati usa una deviazione ortogonale distinguibile dal tratto parallelo.

### Inserire la mappa in un blocco di codice Markdown

È già supportato il blocco `mindmap-eome` che riferisce un'altra nota Markdown:

````markdown
```mindmap-eome
Percorso/della/mappa.md
```
````

In modalità lettura viene mostrata un'**anteprima vettoriale non modificabile** della mappa, ora comprensiva dei collegamenti espliciti e delle frecce, con un comando per aprire la mappa completa. **Nessuna esportazione PDF/SVG è necessaria.** L'editing manoscritto si svolge nella vista EOME della nota collegata, non direttamente dentro il blocco.

## Novità 0.3.2 — Relazioni definite dall'utente

L'aggiornamento implementa la [specifica di collegamenti](docs/specs/relazioni-e-collegamenti.md) senza conversione automatica dei vecchi SVG.

- **Figlio / conseguenza:** crea un nodo manoscritto collegato con un tratto orizzontale. Se un concetto ne ha più di uno, una dorsale verticale comune raccoglie le uscite, evitando di duplicare i segmenti.
- **Dettaglio / causa:** crea un nodo collegato con un gomito a L, orientato automaticamente in base agli ostacoli.
- **Nuovo fratello:** inserisce un nodo allo stesso livello Markdown, **senza attribuirgli una relazione semantica**.
- **Collega (icona catena):** attiva lo strumento Apple Pencil, trascina dal primo nodo al secondo, quindi scegli il rapporto. La modalità Penna continua a produrre tratti SVG quando Collega è disattivato.
- **Personalizza un collegamento:** tocca la linea per modificarne il tipo, applicare frecce all'origine/destinazione/entrambe, oppure seleziona **«Freccia esattamente qui»** per collocarla nella posizione toccata lungo il tracciato. Puoi anche eliminare soltanto la relazione.
- **Persistenza:** le nuove relazioni sono conservate nella frontmatter YAML della nota, alla chiave `eome-relations-v1`. Non dipendono dai numeri di riga dell'outline.
- **Layout:** nuove mappe con preferenza sinistra→destra; i layout già configurati nel frontmatter restano validi.
- **Compatibilità:** le note esistenti **senza** `eome-relations-v1` conservano la grafica 0.2.8. Il primo collegamento esplicito attiva il nuovo routing per quella nota: i vecchi archi **non vengono convertiti semanticamente** e smettono di comparire, pur conservando integralmente i nodi Markdown/SVG. Le nuove mappe hanno il campo anche quando è vuoto, per non inventare collegamenti. Conviene provare la transizione su una copia del file.

**Release 0.3.2:** il layout legacy resta leggibile nelle note senza lo schema esplicito; passando alla nuova modalità le vecchie linee non vengono interpretate né convertite. Il comando per creare una mappa manoscritta da zero imposta subito la modalità esplicita.\n\n**Nota per i test iPad:** le frecce personalizzate e il gesto Collega non sono ancora stati verificati con Apple Pencil reale; consigliato un vault di prova. Le relazioni testuali con contenuto identico non possono essere distinte con certezza; per tali nodi usare due SVG separati o testi unici. La rinomina di un collegamento SVG potrebbe richiedere di ripristinare la relazione; è prevista una successiva migrazione di identificatori.

## Modalità pen-first (0.2.4)

Il plugin funziona dentro Obsidian: apri una nota Markdown e scegli **Mindmap view of this file** dal menu della nota. La modalità Penna è **attiva per impostazione predefinita**.

### Creare e scrivere un nodo

1. Con una **nota Markdown vuota**, premi **Nuovo nodo figlio manoscritto** (icona file/penna) per creare la **radice** senza usare la tastiera.
2. Seleziona un nodo della mappa con un tocco del **dito**, poi usa **Nuovo nodo figlio manoscritto** oppure **Nuovo nodo fratello manoscritto** nella barra degli strumenti.
3. Con Apple Pencil **scrivi direttamente entro il disegno del nodo**: i tratti vengono salvati in un SVG editabile. Il dito serve per selezionare, spostarsi e zoomare.
4. Per **espandere**, tocca la nuova icona **ingrandisci** nell'angolo alto del nodo manoscritto. È visibile anche senza hover su iPad.
5. Nell'editor espanso puoi continuare a scrivere, poi scegliere **Salva**, **Salva + figlio** oppure **Salva + fratello**.
6. Con **Salva + figlio/fratello**, il disegno corrente viene salvato, viene creato automaticamente il nodo collegato, e si apre subito **l'editor espanso del nuovo nodo**. Ripeti per prendere appunti senza rientrare ogni volta nella mappa.

Anche i due controlli rapidi **Add child** e **Add sibling** dei nodi selezionati creano SVG manoscritti finché la modalità Penna è attiva. Disattivandola dalla barra riemerge il comportamento originale per i nodi testuali.

### Comandi Obsidian

- `Toggle direct handwriting on drawing nodes`
- `Add a handwritten child node (or first root)`
- `Add a handwritten sibling node`

Il **layout Dagre automatico** resta attivo; la struttura continua a essere un normale elenco Markdown con immagini SVG incorporate.

## Limiti del prototipo

- Funziona con i **nodi manoscritti SVG creati da EOME**, non con i normali nodi testuali o con le lavagne Excalidraw incorporate.
- La penna deve essere riconosciuta come `pointerType = pen`; il dito conserva la navigazione.
- Non include cancellino, selezione dei singoli tratti o annullamento del singolo tratto dalla vista mappa; per queste operazioni usa l'editor del nodo.
- I tratti sono salvati nello stesso SVG editabile usato dal plugin, ma la nuova versione pen-first non è ancora stata verificata su hardware reale.
- Il layout potrebbe aggiornarsi leggermente dopo la conclusione dei tratti.
- Evita di modificare lo stesso disegno su dispositivi differenti contemporaneamente; fai un backup del vault prima della prova.

## Sviluppo

```bash
npm ci
npm test
npm run build
```

Un workflow GitHub Actions su `main` verifica test e compilazione, quindi crea una release **prerelease** denominata `0.3.4` con i file richiesti da BRAT.

## Provenienza e licenza

Derivato dal progetto originale di Kornelius Paede; conserva la licenza MIT e gli avvisi relativi alle dipendenze di terze parti. Questa variante non è una release ufficiale del suo autore.

## Mappe calligrafiche (0.2.5–0.2.8)

Questa release **0.2.8** raggruppa i miglioramenti delle fasi 0.2.5, 0.2.6, 0.2.7 e 0.2.8.

**0.2.5 — SVG trasparenti.** I nuovi nodi manoscritti vengono salvati come veri SVG, senza il rettangolo bianco di fondo. Nella mappa sono nascosti sfondo, bordo e ombra delle schede; rimane una zona invisibile per toccare, spostare e selezionare i nodi. La selezione è indicata da una sottolineatura discreta. I vecchi SVG con sfondo bianco **non vengono convertiti**; se li modifichi, viene conservato il loro fondale.

**0.2.6 — Dimensionamento automatico.** L'ingombro di un nodo SVG nativo è calcolato dal suo `viewBox` e dal rapporto fra larghezza e altezza del disegno; le altre note Markdown mantengono il comportamento precedente. Nell'editor espanso il disegno viene adattato ai tratti al salvataggio; nella scrittura diretta il `viewBox` resta fermo durante i tratti e viene compattato **dopo 1,8 s di inattività**, per evitare che la penna segua una superficie che si sposta. I disegni continuano a essere vettoriali.

**0.2.7 — Collegamenti a L e fra fratelli.** Dagre mantiene il layout gerarchico. È visibile un collegamento ortogonale fra genitore e primo figlio; gli altri figli sono uniti fra loro da tratti rettilinei (orizzontali con layout TB, verticali se hai scelto LR). Gli archi necessari all'algoritmo di posizionamento restano nel grafo ma sono invisibili, evitando linee ridondanti.

**0.2.8 — Frecce sui collegamenti.** Tocca il piccolo pulsante con simbolo di freccia sul nodo figlio. Ogni tocco passa tra **nessuna → finale → iniziale → doppia**. La freccia si applica al collegamento che entra in quel nodo, sia esso il ramo a L o il tratto fra fratelli. Le preferenze sono salvate nella **frontmatter YAML** della nota come `eome-edge-arrows`, associandole al percorso SVG (non al numero di riga); si sincronizzano quindi insieme al file Markdown.

Le anteprime sono native in Obsidian: non serve esportare PDF, PNG o SVG per vedere una mappa.

### Compatibilità e limiti

- Nessun file SVG già presente nel vault viene modificato automaticamente durante l'aggiornamento.
- Un disegno esistente conserva il vecchio sfondo bianco quando viene nuovamente salvato.
- I nodi testuali con lo stesso identico contenuto condividono la preferenza di freccia, mentre i nodi SVG hanno chiavi individuali.
- Con un layout orientato da sinistra a destra, il collegamento fra fratelli diventa verticale, coerentemente con la disposizione scelta.
- Le modifiche alle frecce richiedono il supporto Obsidian a `processFrontMatter`, presente nelle versioni recenti.
- Come ogni release beta, va provata in un vault di test prima di usarla sui materiali importanti.

### Limiti tecnici attuali (0.3.2)

La prevenzione delle sovrapposizioni usa una fusione dei segmenti collineari e una scelta locale dei gomiti per evitare i nodi intermedi. **Non è ancora un risolutore globale di incroci**. La geometria è ancorata al centro dell'immagine SVG visualizzata, che approssima il centro della grafia, ma non calcola ancora il centro esatto dell'inchiostro. La posizione delle frecce personalizzate viene scelta toccando un punto del collegamento e selezionando «Freccia esattamente qui»; il trascinamento continuo della freccia non è ancora implementato. Le prove reali su iPad restano necessarie.
