import 'package:flutter/material.dart';

class ProductDetailScreen extends StatelessWidget {
  const ProductDetailScreen({super.key, required this.productId});
  final String productId;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Product')),
        body: Center(child: Text(productId)),
      );
}
