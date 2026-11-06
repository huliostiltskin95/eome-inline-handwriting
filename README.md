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

Un workflow GitHub Actions su `main` verifica test e compilazione, quindi crea una release **prerelease** denominata `0.2.4` con i file richiesti da BRAT.

## Provenienza e licenza

Derivato dal progetto originale di Kornelius Paede; conserva la licenza MIT e gli avvisi relativi alle dipendenze di terze parti. Questa variante non è una release ufficiale del suo autore.
