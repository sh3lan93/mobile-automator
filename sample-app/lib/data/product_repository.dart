import 'dart:convert';
import 'package:flutter/services.dart' show rootBundle;
import 'package:sample_shop/models/product.dart';

class ProductRepository {
  final List<Product> _products = <Product>[];
  final List<Category> _categories = <Category>[];

  List<Product> get products => List.unmodifiable(_products);
  List<Category> get categories => List.unmodifiable(_categories);

  Future<void> load() async {
    final productsRaw = await rootBundle.loadString('assets/data/products.json');
    final categoriesRaw =
        await rootBundle.loadString('assets/data/categories.json');

    _products
      ..clear()
      ..addAll((jsonDecode(productsRaw) as List<dynamic>)
          .map((e) => Product.fromJson(e as Map<String, dynamic>)));
    _categories
      ..clear()
      ..addAll((jsonDecode(categoriesRaw) as List<dynamic>)
          .map((e) => Category.fromJson(e as Map<String, dynamic>)));
  }

  List<Product> featured() =>
      _products.where((p) => p.featured).toList(growable: false);

  List<Product> byCategory(String slug) =>
      _products.where((p) => p.categorySlug == slug).toList(growable: false);

  Product byId(String id) => _products.firstWhere((p) => p.id == id);
}
