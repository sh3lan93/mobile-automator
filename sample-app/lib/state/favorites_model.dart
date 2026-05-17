import 'package:flutter/foundation.dart';

class FavoritesModel extends ChangeNotifier {
  final Set<String> _ids = <String>{};

  bool isFavorite(String productId) => _ids.contains(productId);

  void toggle(String productId) {
    if (!_ids.add(productId)) _ids.remove(productId);
    notifyListeners();
  }
}
