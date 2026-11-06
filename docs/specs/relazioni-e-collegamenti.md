# EOME — Specifica del sistema di relazioni e collegamenti

> **Stato:** specifica funzionale di riferimento per il prossimo aggiornamento.  
> **Priorità:** requisiti confermati dall'utente il 6 novembre 2026, dopo il questionario e la lettura del disegno manoscritto.  
> **Implementazione:** disponibile in prima versione nella **0.3.2**. La 0.2.8 conserva il vecchio routing; la 0.3.2 introduce dati di coppia, segni — / L, dorsali condivise, Apple Pencil «Collega» e frecce configurabili. Il router usa ancora euristiche locali, non garantisce il minimo globale di incroci. Le prove fisiche su iPad restano da effettuare.
>
> In caso di conflitto con le discussioni precedenti, **prevale l'ultima precisazione**: «figlio = linea orizzontale = conseguenza; linea a L = dettaglio o causa; entrambi possono avere una freccia dove si vuole».

## 1. Visione

EOME deve essere una **mappa calligrafica pen-first**, con nodi rappresentati da parole/appunti manoscritti in SVG trasparente, nitidi a qualunque zoom, senza schede, bordi o sfondi. L'utente definisce **per ogni coppia di nodi** quale relazione intende esprimere; l'applicazione calcola la disposizione e il tracciato più leggibili senza reinterpretare la relazione.

L'organizzazione deve ricordare per leggibilità una mappa Coggle, ma usare **segmenti ortogonali, un solo colore per i collegamenti e tratti condivisi dove appropriato**. Il layout prevalente procede da **sinistra a destra**.

## 2. Vocabolario vincolante

| Relazione semantica esplicita | Geometria richiesta | Significato |
| --- | --- | --- |
| **Figlio** | **Linea orizzontale** «—» | Derivazione/relazione subordinata scelta dall'utente |
| **Conseguenza** | **Linea orizzontale** «—» | Conseguenza o sviluppo logico |
| **Dettaglio** | **Gomito a L** «└» o «┌» secondo lo spazio | Specificazione di un concetto |
| **Causa** | **Gomito a L** «└» o «┌» secondo lo spazio | Rapporto causale |
| **Trasversale** | Geometria scelta esplicitamente, separata dalla gerarchia | Collegamento tra nodi al di fuori delle due famiglie sopra |

**Regole di precedenza e disambiguazione:**

- La forma **non deriva** automaticamente dall'ordine dei nodi, dal loro rango Dagre né dal fatto che due righe abbiano lo stesso livello Markdown.
- «Fratello» può continuare a essere un'**operazione di inserimento** («nuovo nodo allo stesso livello»), ma **non è di per sé una classe geometrica o causale**. Il rapporto grafico A—B va associato esplicitamente alla coppia interessata.
- La formulazione precedente «padre–figlio = L» e «fratello = —» è **superata**. Non usarla per implementare il nuovo router.
- Il layout può spostare e allineare i nodi, ma **non può creare, cancellare o convertire relazioni** in base alla loro posizione.

## 3. Nodi e punti di attacco

- Ogni nodo manoscritto conserva un **SVG nativo modificabile**, con sfondo trasparente, pressione e tratti vettoriali preservati.
- Dimensione visiva e spaziatura dipendono dai **limiti effettivi della grafia**; il rettangolo invisibile per i gesti non deve comparire nella mappa.
- **Rettifica 0.3.3:** tutti i collegamenti partono dal **lato esterno della grafia**, all'altezza del suo centro verticale, con piccolo margine di sicurezza. La richiesta precedente di partenza dal centro geometrico è superata.
- Per non coprire i tratti manoscritti, il rendering deve gestire l'eventuale segmento sotto la grafia (ad esempio interrompendolo al contorno visivo), mantenendo la relazione geometricamente ancorata al centro richiesto.
- Il riadattamento dei nodi non deve cambiare gli identificatori né disassociare le frecce.

## 4. Routing di un rapporto per coppia

- Una relazione è un arco identificato dalla coppia **origine–destinazione** e da un **tipo semantico scelto dall'utente**.
- **Figlio/conseguenza:** segmento visibile **orizzontale**. Quando le destinazioni hanno quote verticali diverse, il router può usare una **dorsale verticale condivisa** e un'uscita orizzontale per ciascuna destinazione. La dorsale è una soluzione di disegno, **non una nuova relazione**.
- **Dettaglio/causa:** percorso ortogonale con **un gomito a 90°** (L orientata in base allo spazio), associato alla coppia richiesta. Se più percorsi condividono lo stesso tratto iniziale, tale tratto è disegnato una sola volta.
- **Rapporti trasversali:** non nascono dall'outline; si aggiungono solo tramite comando dedicato. Devono poter raggiungere il nodo scelto senza riorganizzare la gerarchia.
- Un tratto condiviso può appartenere a più archi, ma ogni **arco logico mantiene identificatore, tipo e frecce propri**.

### Prevenzione delle sovrapposizioni

1. Riutilizzare segmenti collineari compatibili come **una singola dorsale**.
2. Non sovrapporre frecce, scrittura e segmenti in modo ambiguo.
3. Preferire distanziamento e instradamenti ortogonali leggibili; evitare incroci se esiste una soluzione equivalente.
4. Non confondere tratti che si incrociano con tratti effettivamente connessi: eventuali incroci non creano nuove relazioni.
5. Mantenere la stabilità visiva durante la scrittura: aggiornare il layout quando serve, non a ogni campione della penna.
6. Conservare un **colore uniforme configurabile globalmente** per i collegamenti; eventuali evidenziazioni non devono creare un significato non richiesto.

## 5. Frecce libere e indipendenti dalla geometria

Ogni **singola relazione**, sia orizzontale sia a L (e anche trasversale), può avere frecce opzionali. Il requisito «dove si vuole» significa che l'utente deve poter decidere **su quale collegamento collocare la freccia e in quale punto/direzione**, senza limitazioni al tipo di relazione.

- Supportare come minimo: **nessuna freccia, freccia all'origine, freccia alla destinazione, doppia freccia**.
- Specifica di interazione desiderata: possibilità di **spostare la freccia lungo il percorso selezionato con Apple Pencil**; salvare la posizione in termini relativi alla lunghezza del percorso, così da conservare l'intenzione dopo un ri-layout.
- Frecce posizionate su un **segmento condiviso** restano riferite all'arco logico scelto: il motore deve evitare di renderle ambigue rispetto alle altre relazioni che percorrono il segmento.
- Una freccia non modifica il tipo semantico dell'arco. La direzione dell'indicatore e l'orientamento grafico del percorso sono proprietà diverse.

## 6. Interazioni iPad / Apple Pencil

Occorrono **entrambe** le modalità di creazione:

1. **Selezione + pulsante:** seleziono un nodo di riferimento e creo direttamente un altro nodo, dichiarandone il tipo di relazione. Le azioni rapide devono restare pen-first, senza tastiera obbligatoria.
2. **Gesto di collegamento:** con lo strumento **Collega** attivo, traccio con Apple Pencil un gesto tra due nodi già presenti; scelgo «figlio/conseguenza» (—), «dettaglio/causa» (L) o «trasversale». I segni disegnati in modalità **Scrivi** restano contenuto SVG e **non** vengono convertiti automaticamente in collegamenti.
3. **Modifica relazione:** tocco un collegamento, ne cambio la semantica, la forma consentita o le frecce; il layout si aggiorna senza modificare i tratti dei nodi.
4. **Cancellazione:** rimuovere una relazione non elimina i due nodi. Rimuovere un nodo richiede una gestione esplicita dei suoi archi.

## 7. Rappresentazione dati e compatibilità

Il modello deve distinguere **nodi**, **archi logici**, **segmenti grafici** e **posizioni prodotte dal layout**. Non memorizzare le relazioni solo in base al numero di riga Markdown.

Schema concettuale illustrativo, **non ancora un formato persistito**:

```ts
type RelationKind = 'figlio' | 'conseguenza' | 'dettaglio' | 'causa' | 'trasversale';
type Geometry = 'horizontal' | 'elbow' | 'explicit';
interface MapRelation {
  id: string;              // stabile dopo riordini
  sourceNodeId: string;
  targetNodeId: string;
  kind: RelationKind;       // dichiarato dall'utente
  geometry: Geometry;      // derivata dal kind, tranne trasversale
  arrows: Array<{
    position: number;      // 0..1, posizione relativa sull'arco
    direction: 'forward' | 'backward';
  }>;
}
```

- Usare identificatori **stabili per nodo e relazione**. Per i nodi con SVG esistente il percorso può aiutare a una prima identificazione, ma deve essere gestito anche il caso di rinomina/spostamento.
- Persistenza insieme alla nota Markdown oppure in un metadato associato sincronizzabile; la scelta concreta richiede test contro conflitti con l'editor Markdown, frontmatter e Syncthing.
- **Nessuna migrazione distruttiva** degli SVG, nessuna riscrittura massiva di note e nessuna conversione automatica della 0.2.8 alla nuova semantica.
- Tenere distinta la modalità di compatibilità per mappe 0.2.8: la loro geometria non deve essere reinterpretata come relazione esplicitamente scelta, a meno di un'azione di migrazione volontaria.
- Anteprima direttamente in Obsidian; **nessun PDF/SVG di esportazione necessario**.

## 8. Caso di test tratto dall'immagine dell'utente

Il disegno mostra «NOTA 1» a sinistra di una dorsale verticale comune; tre derivazioni orizzontali verso «ARG. 1», «ARG. 2», «ARG. 3»; per ogni argomento, un collegamento a L verso «DETTAGLIO 1», «DETTAGLIO 2», «DETTAGLIO 3»; infine «CAUSA» è collegato trasversalmente con una freccia verso «DETTAGLIO 3». La freccia gialla illustrativa va intesa come promemoria di personalizzazione delle frecce, non come nodo aggiuntivo.

La legenda blu scritta nel disegno riflette una formulazione **precedente**. La **legenda definitiva è quella della sezione 2**, confermata *dopo* l'invio dell'immagine.

Per accettare il risultato:

- Creare i tre collegamenti orizzontali «NOTA 1 → ARG.» **sulla dorsale condivisa**, senza triplicare la linea verticale.
- Rendere tre collegamenti distinti a L «ARG. → DETTAGLIO».
- Realizzare «CAUSA → DETTAGLIO 3» mediante comando trasversale e freccia orientata correttamente.
- Aggiungere, togliere e spostare una freccia su ciascuno dei due tipi geometrici, mantenendo la coppia a cui appartiene.
- Cambiare l'ordine dei nodi senza cambiare la semantica né l'orientamento scelto delle frecce.
- Evitare intersezioni ingannevoli e sovrapposizioni con i tratti manoscritti.
- Verificare la navigazione e la modifica con Apple Pencil su iPad, non solo la compilazione TypeScript.
- Verificare che SVG, collegamenti e anteprime sopravvivano alla riapertura e alla sincronizzazione della nota.

## 9. Piano di implementazione (successivo, non incluso)

1. **Modello relazioni e persistenza** con identificatori stabili e caricamento compatibile.
2. **Router ortogonale** per coppie tipizzate, dorsali condivise, distanze e incroci.
3. **Editing pen-first**: gesto Collega, selezione degli archi, frecce posizionabili.
4. **Test strutturali, grafici e su iPad** prima della release BRAT.

**Stato 0.3.2:** prima implementazione completata nei sorgenti e compilata con test automatici. Rimangono aperti: collaudo iPad/Apple Pencil; risoluzione avanzata degli incroci e degli ostacoli; gestione delle rinomine dei file SVG; identità persistente per testi identici; verifica delle esportazioni con il nuovo SVG layer. Le mappe preesistenti conservano la visualizzazione legacy se non è presente `eome-relations-v1`; attivando le relazioni esplicite, gli archi precedenti non vengono convertiti e non vengono visualizzati.


## Rettifica 0.3.3 — Penna/mouse e creazione rapida

- Nel canvas EOME non si possono inserire né modificare **campi testuali**. Tutti i nuovi nodi sono SVG editabili con Apple Pencil o mouse; i nodi di testo preesistenti restano visibili in sola lettura.
- Il menu contestuale di creazione offre **Parallelo —** e **A L**, ciascuno con **nessuna freccia, freccia all'inizio, alla fine o doppia**. I tipi semantici più specifici rimangono impostabili nel menu del collegamento esistente.
- Il routing deve partire dal **bordo laterale del disegno**, non dal centro; in caso di quote differenti si usa una dorsale ortogonale condivisibile.
- I blocchi `mindmap-eome` che contengono il percorso della nota Markdown mostrano un'anteprima vettoriale read-only dei collegamenti espliciti; l'editing avviene aprendo la mappa completa.
- Lo strumento Collega accetta trascinamento sia con penna sia con mouse; la scrittura diretta su SVG accetta i medesimi dispositivi.
- Limiti: per l'ancoraggio viene usato il bordo dell'immagine SVG, non il contorno preciso di ogni tratto; resta da collaudare il comportamento nell'interfaccia iPad e minimizzare globalmente gli incroci.


## Attuazione 0.3.4 — Mappa operativa nel blocco della stessa nota

Il processore Markdown `mindmap-eome` accetta ora (oltre al vecchio percorso `.md` usato come anteprima) anche un outline SVG al proprio interno, eventualmente vuoto. Il blocco viene renderizzato automaticamente in una mappa **interattiva** nel documento ospitante: selezione del nodo, creazione in-place di altri SVG paralleli o a L, disegno con Apple Pencil o mouse, modifica delle estremità delle frecce tramite menu. I tratti restano in allegati SVG, le relazioni nella frontmatter YAML della nota contenente il blocco. La modifica dei blocchi richiede corrispondenza esatta con il contenuto precedente, per proteggere note con più blocchi. I blocchi con riferimento a file esterno restano anteprime read-only.

La finestra espansa mostra «Salva + parallelo» e «Salva + L», e non più «Salva + figlio»/«Salva + fratello». Dalla vista principale si possono configurare le frecce attraverso il menu contestuale del nodo. Il salvataggio di nuovi collegamenti aspetta la sincronizzazione dell'outline per ridurre le omissioni.

**Limiti residui:** da collaudare su hardware iPad reale la funzionalità in Live Preview e la ri-renderizzazione dopo la scrittura; il motore non garantisce ancora l'eliminazione globale di tutti gli incroci.
