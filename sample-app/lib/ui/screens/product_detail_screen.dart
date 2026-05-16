import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/state/favorites_model.dart';
import 'package:sample_shop/ui/widgets/placeholder_image.dart';
import 'package:sample_shop/ui/widgets/qty_stepper.dart';

class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.productId});
  final String productId;
  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  int _qty = 1;

  @override
  Widget build(BuildContext context) {
    final product = context.read<ProductRepository>().byId(widget.productId);
    final favs = context.watch<FavoritesModel>();
    final isFav = favs.isFavorite(product.id);

    return Scaffold(
      appBar: AppBar(title: Text(product.title)),
      body: ListView(
        children: [
          GestureDetector(
            onDoubleTap: () =>
                context.read<FavoritesModel>().toggle(product.id),
            child: PlaceholderImage(id: product.id, label: product.title),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(product.title,
                    style: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('\$${product.price.toStringAsFixed(2)}',
                    style: const TextStyle(fontSize: 18)),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    QtyStepper(
                      qty: _qty,
                      onInc: () => setState(() => _qty++),
                      onDec: () =>
                          setState(() => _qty = _qty > 1 ? _qty - 1 : 1),
                    ),
                    Semantics(
                      identifier: 'product_button_favorite',
                      button: true,
                      toggled: isFav,
                      child: IconButton(
                        icon: Icon(isFav
                            ? Icons.favorite
                            : Icons.favorite_border),
                        onPressed: () =>
                            context.read<FavoritesModel>().toggle(product.id),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Semantics(
                  identifier: 'product_button_add_to_cart',
                  button: true,
                  child: ElevatedButton(
                    onPressed: () {
                      context.read<CartModel>().add(product, qty: _qty);
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Added to cart')),
                      );
                    },
                    child: const Text('Add to cart'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
