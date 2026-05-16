import 'package:flutter/foundation.dart';
import 'package:sample_shop/models/product.dart';

class CartLine {
  CartLine(this.product, this.qty);
  final Product product;
  int qty;
}

class CartModel extends ChangeNotifier {
  final Map<String, CartLine> _lines = <String, CartLine>{};

  List<CartLine> get lines => _lines.values.toList(growable: false);
  bool get isEmpty => _lines.isEmpty;
  int get totalItems =>
      _lines.values.fold(0, (sum, l) => sum + l.qty);
  double get totalPrice =>
      _lines.values.fold(0.0, (sum, l) => sum + l.product.price * l.qty);

  bool contains(String productId) => _lines.containsKey(productId);

  void add(Product p, {int qty = 1}) {
    final existing = _lines[p.id];
    if (existing == null) {
      _lines[p.id] = CartLine(p, qty);
    } else {
      existing.qty += qty;
    }
    notifyListeners();
  }

  void remove(String productId) {
    if (_lines.remove(productId) != null) notifyListeners();
  }

  void clear() {
    if (_lines.isEmpty) return;
    _lines.clear();
    notifyListeners();
  }
}
