'use strict';

function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  // API istekleri için JSON hata dön
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Oturum açmanız gerekiyor' });
  }
  res.redirect('/admin/login');
}

module.exports = { requireAuth };
