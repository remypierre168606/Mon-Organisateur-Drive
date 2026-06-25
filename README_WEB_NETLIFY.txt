MON ORGANISEUR DRIVE WEB - V34b

Cette version est prête à être déposée sur un hébergeur web statique comme Netlify.

FICHIERS À METTRE EN LIGNE :
- index.html
- app.js
- style.css
- app-local-base.js
- README_UTILISATION.txt

ÉTAPES NETLIFY :
1. Va sur https://app.netlify.com
2. Connecte-toi ou crée un compte.
3. Clique sur Add new site / Deploy manually.
4. Glisse le dossier complet Mon-Organiseur-Drive-Web-v34b dans la zone de dépôt.
5. Netlify donnera une adresse du type :
   https://mon-organiseur-drive.netlify.app

ÉTAPE GOOGLE CLOUD OBLIGATOIRE :
Dans Google Cloud > Google Auth Platform > Clients > ton Client OAuth :
1. Ajoute l'adresse Netlify dans Origines JavaScript autorisées.
   Exemple : https://mon-organiseur-drive.netlify.app
2. Garde aussi http://localhost:8000 pour les tests locaux.
3. Enregistre.

UTILISATION :
1. Ouvre l'adresse Netlify.
2. Va sur ⚙️ Drive.
3. Colle le même Client ID Google.
4. Clique Enregistrer le Client ID.
5. Clique Se connecter à Google Drive.
6. Clique Charger depuis Drive.

IMPORTANT :
Avant toute mise à jour de version, fais toujours Exporter JSON depuis l'ancienne version.


V35.2 : IMPORTANT GOOGLE CLOUD
Cette version utilise un flux OAuth par redirection, plus fiable sur Netlify.
Dans Google Cloud > Client OAuth, ajoute :
- Origines JavaScript autorisées : l'origine affichée dans la page Drive
- URI de redirection autorisés : l'URI de redirection affichée dans la page Drive
Exemple Netlify :
Origine : https://eclectic-faloodeh-678e05.netlify.app
Redirection : https://eclectic-faloodeh-678e05.netlify.app/


V35.2 : CORRECTION
- URI de redirection forcée à la racine du site : https://ton-site.netlify.app/
- Le fichier app.js doit contenir VERSION_LABEL = V35.2
- index.html doit charger app.js?v=352
