/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@vigon/database',
    '@vigon/shared',
    '@vigon/extraction',
    '@vigon/services',
  ],
  experimental: {
    serverActions: {
      // 16 Mo et non 10 : la liste blanche des dépôts en accepte 15
      // (`lib/fichiers/depot.ts`), et Next rejetait le corps AVANT que la
      // validation ne s'exécute. Le fournisseur recevait une erreur générique
      // là où le message lui aurait dit quoi faire. Les deux valeurs doivent
      // s'accorder, avec la marge de l'encodage multipart.
      bodySizeLimit: '16mb',
    },
  },

  /**
   * En-têtes de sécurité.
   *
   * Sans objet sur `localhost`, indispensables en ligne : les pages publiques
   * portent leur autorisation DANS L'URL (`/offre/<jeton>`), ce qui change ce
   * que coûte chaque fuite d'en-tête ou chaque requête en clair.
   *
   * Pas de `Content-Security-Policy` ici, délibérément : Next 14 injecte des
   * scripts en ligne qui exigent des nonces, et une CSP posée sans être
   * éprouvée écran par écran casse l'application en silence. À écrire pendant
   * la migration Next 16, où le rendu change de toute façon.
   */
  async headers() {
    return [
      {
        source: '/:chemin*',
        headers: [
          {
            // Le jeton est dans l'URL : sans cette règle, le navigateur le
            // joignait en clair à chaque visuel produit chargé depuis le
            // stockage, qui est une autre origine.
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Même raison, transport cette fois : une seule requête en http
            // expose le jeton de la page d'offre.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Les packages internes sont écrits en ESM NodeNext : leurs imports relatifs
    // portent l'extension .js alors que le fichier sur disque est un .ts.
    // TypeScript fait la correspondance, webpack non — extensionAlias la lui
    // apprend, sans quoi « Can't resolve './env.js' » au premier import.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
