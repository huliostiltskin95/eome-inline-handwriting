# EOME Inline Handwriting

Fork sperimentale di [Excerpt-Outline-Mindmap-Editor](https://github.com/kpaede/Excerpt-Outline-Mindmap-Editor) di Kornelius Paede, distribuito secondo la stessa licenza MIT.

Questa versione aggiunge **scrittura a mano direttamente nei nodi della mappa**, senza aprire il relativo editor. È destinata alla prova su Obsidian mobile (iPad / Apple Pencil, dispositivi BOOX con stilo) e desktop con penna compatibile.

## Installazione con BRAT

1. Apri Obsidian → Plugin della comunità e installa/attiva **BRAT**.
2. In BRAT seleziona **Add beta plugin for testing** e inserisci `huliostiltskin95/eome-inline-handwriting`.
3. Verifica che nel repository sia disponibile una release con `main.js`, `manifest.json` e `styles.css`.
4. Attiva **EOME Inline Handwriting** in Plugin della comunità.

Il plugin ha un **ID diverso dall'originale**, quindi non ne sovrascrive i file. Per evitare che entrambi cerchino di gestire le stesse note, si consiglia di **disattivare il plugin EOME originale durante le prove**.

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

Un workflow GitHub Actions su `main` verifica test e compilazione, quindi crea una release **prerelease** denominata `0.2.8` con i file richiesti da BRAT.

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
