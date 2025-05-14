"""
This is a sample Python file to test docstring extraction.
It contains various classes and functions with docstrings.
"""

class SampleClass:
    """
    This is a sample class that demonstrates docstring extraction.
    
    Attributes:
        name (str): The name of the sample
        value (int): The value of the sample
    """
    
    def __init__(self, name, value=0):
        """
        Initialize the SampleClass.
        
        Args:
            name (str): The name to assign
            value (int, optional): The initial value. Defaults to 0.
        """
        self.name = name
        self.value = value
    
    def increment(self, amount=1):
        """
        Increment the value by the specified amount.
        
        Args:
            amount (int, optional): The amount to increment by. Defaults to 1.
            
        Returns:
            int: The new value after incrementing
        """
        self.value += amount
        return self.value
    
    def get_info(self):
        """
        Get a formatted string with the object's information.
        
        Returns:
            str: A string containing the name and value
        """
        return f"Name: {self.name}, Value: {self.value}"


def calculate_sum(numbers):
    """
    Calculate the sum of a list of numbers.
    
    Args:
        numbers (list): A list of numbers to sum
        
    Returns:
        float: The sum of all numbers in the list
        
    Raises:
        TypeError: If the input is not a list or if any element is not a number
    """
    if not isinstance(numbers, list):
        raise TypeError("Input must be a list")
    
    total = 0
    for num in numbers:
        if not isinstance(num, (int, float)):
            raise TypeError("All elements must be numbers")
        total += num
    
    return total


def process_data(data, callback=None):
    """
    Process the given data with an optional callback function.
    
    This function demonstrates a more complex docstring with multiple
    paragraphs and examples.
    
    Args:
        data (dict): The data to process
        callback (callable, optional): A function to call with the processed result
        
    Returns:
        dict: The processed data
        
    Examples:
        >>> process_data({"name": "test"})
        {"name": "test", "processed": True}
        
        >>> def print_result(result):
        ...     print(f"Result: {result}")
        >>> process_data({"name": "test"}, print_result)
        Result: {"name": "test", "processed": True}
        {"name": "test", "processed": True}
    """
    result = data.copy()
    result["processed"] = True
    
    if callback and callable(callback):
        callback(result)
    
    return result


if __name__ == "__main__":
    # Create a sample object
    sample = SampleClass("Test", 10)
    print(sample.get_info())
    
    # Increment the value
    new_value = sample.increment(5)
    print(f"New value: {new_value}")
    
    # Calculate a sum
    numbers = [1, 2, 3, 4, 5]
    total = calculate_sum(numbers)
    print(f"Sum: {total}")
    
    # Process some data
    data = {"name": "Example", "value": 42}
    result = process_data(data, lambda r: print(f"Processed: {r}"))
    print(f"Final result: {result}")
