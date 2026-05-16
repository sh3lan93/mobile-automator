import 'package:flutter/material.dart';
import 'package:sample_shop/models/product.dart';
import 'package:sample_shop/ui/widgets/placeholder_image.dart';

class ProductCard extends StatelessWidget {
  const ProductCard({
    super.key,
    required this.product,
    required this.semanticsId,
    required this.onTap,
  });

  final Product product;
  final String semanticsId;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      identifier: semanticsId,
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              PlaceholderImage(id: product.id, label: product.title),
              Padding(
                padding: const EdgeInsets.all(8),
                child: Text(product.title,
                    maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
              Padding(
                padding: const EdgeInsets.only(left: 8, bottom: 8),
                child: Text('\$${product.price.toStringAsFixed(2)}'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
